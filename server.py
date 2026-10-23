#!/usr/bin/env python3
"""
Velostat Plantar Pressure Map & Biomechanical Diagnostics Server
Serves static web files and provides a CORS-free server-side proxy for:
- NVIDIA NIM API (https://integrate.api.nvidia.com/v1)
- Google Gemini API (https://generativelanguage.googleapis.com/v1beta)
- Groq Cloud API (https://api.groq.com/openai/v1)
- OpenAI API (https://api.openai.com/v1)
- OpenRouter API (https://openrouter.ai/api/v1)
- Ollama / Local LLM (http://localhost:11434/v1)
- Custom OpenAI-compatible endpoints
"""

import http.server
import json
import urllib.request
import urllib.error
import urllib.parse
import os
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

PROVIDER_URLS = {
    'nvidia': 'https://integrate.api.nvidia.com/v1',
    'gemini': 'https://generativelanguage.googleapis.com/v1beta/openai',
    'groq': 'https://api.groq.com/openai/v1',
    'openai': 'https://api.openai.com/v1',
    'openrouter': 'https://openrouter.ai/api/v1',
    'ollama': 'http://localhost:11434/v1',
    'custom': ''
}

DEFAULT_MODELS = {
    'nvidia': [
        'meta/llama-3.1-70b-instruct',
        'meta/llama-3.3-70b-instruct',
        'mistralai/mixtral-8x22b-instruct',
        'meta/llama-3.1-8b-instruct',
        'nvidia/llama-3.1-nemotron-70b-instruct'
    ],
    'gemini': [
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-2.5-flash'
    ],
    'groq': [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'gemma2-9b-it'
    ],
    'openai': [
        'gpt-4o-mini',
        'gpt-4o',
        'gpt-3.5-turbo'
    ],
    'openrouter': [
        'meta-llama/llama-3.3-70b-instruct',
        'google/gemini-2.0-flash-exp:free',
        'mistralai/mistral-7b-instruct:free',
        'anthropic/claude-3.5-sonnet'
    ],
    'ollama': [
        'llama3.1',
        'llama3',
        'mistral',
        'phi3'
    ]
}

class DiagnosticProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS and disable aggressive browser caching for dev iteration
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/llm/models':
            qs = urllib.parse.parse_qs(parsed.query)
            provider = qs.get('provider', ['nvidia'])[0].lower()
            api_key = qs.get('apiKey', [''])[0].strip()
            base_url = qs.get('baseUrl', [''])[0].strip()
            self._process_models(provider, api_key, base_url)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/llm/chat':
            self.handle_chat()
        elif self.path == '/api/llm/models':
            self.handle_models()
        elif self.path == '/api/llm/test':
            self.handle_test()
        else:
            self.send_error(404, "Endpoint not found")

    def _read_json_body(self):
        try:
            content_len = int(self.headers.get('Content-Length', 0))
            if content_len == 0:
                return {}
            raw = self.rfile.read(content_len).decode('utf-8')
            return json.loads(raw)
        except Exception as e:
            print(f"[Proxy] Error parsing JSON body: {e}", file=sys.stderr)
            return {}

    def _send_json_response(self, status_code, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_test(self):
        req = self._read_json_body()
        provider = req.get('provider', 'nvidia').lower()
        api_key = req.get('apiKey', '').strip()
        base_url = req.get('baseUrl', '').strip() or PROVIDER_URLS.get(provider, '')

        if not api_key and provider != 'ollama':
            self._send_json_response(400, {
                'ok': False,
                'error': 'API key is required for this provider.'
            })
            return

        try:
            if provider == 'gemini':
                models_endpoint = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
                req_obj = urllib.request.Request(models_endpoint, headers={
                    'Content-Type': 'application/json'
                })
            else:
                models_endpoint = f"{base_url.rstrip('/')}/models"
                req_obj = urllib.request.Request(models_endpoint, headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Velostat-Plantar-Diagnostics/2.0'
                })

            with urllib.request.urlopen(req_obj, timeout=10) as resp:
                resp_data = resp.read().decode('utf-8')
                parsed = json.loads(resp_data)

                model_names = []
                if 'models' in parsed and isinstance(parsed['models'], list):
                    for m in parsed['models']:
                        name = m.get('name') or m.get('id')
                        if name:
                            if name.startswith('models/'):
                                name = name[7:]
                            model_names.append(name)
                elif 'data' in parsed and isinstance(parsed['data'], list):
                    for m in parsed['data']:
                        name = m.get('id') or m.get('name')
                        if name:
                            model_names.append(name)

                if not model_names:
                    model_names = DEFAULT_MODELS.get(provider, [])

                self._send_json_response(200, {
                    'ok': True,
                    'message': f'Connection verified with {provider.upper()}! Retrieved {len(model_names)} models.',
                    'models': model_names[:25]
                })

        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='ignore')
            print(f"[Proxy Test Error {e.code}]: {err_body}", file=sys.stderr)
            self._send_json_response(200, {
                'ok': False,
                'error': f'Provider returned HTTP {e.code}: {e.reason}. Check your API key.'
            })
        except Exception as e:
            print(f"[Proxy Test Exception]: {e}", file=sys.stderr)
            self._send_json_response(200, {
                'ok': False,
                'error': f'Network connection failed: {str(e)}'
            })

    def handle_models(self):
        req = self._read_json_body()
        provider = req.get('provider', 'nvidia').lower()
        api_key = req.get('apiKey', '').strip()
        base_url = req.get('baseUrl', '').strip() or PROVIDER_URLS.get(provider, '')
        self._process_models(provider, api_key, base_url)

    def _process_models(self, provider, api_key, base_url):
        defaults = DEFAULT_MODELS.get(provider, ['meta/llama-3.1-70b-instruct'])

        if not api_key and provider != 'ollama':
            self._send_json_response(200, {
                'ok': True,
                'models': defaults,
                'source': 'default_catalogue'
            })
            return

        try:
            if provider == 'gemini':
                endpoint = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
                req_obj = urllib.request.Request(endpoint)
            else:
                endpoint = f"{base_url.rstrip('/')}/models"
                req_obj = urllib.request.Request(endpoint, headers={
                    'Authorization': f'Bearer {api_key}',
                    'User-Agent': 'Velostat-Plantar-Diagnostics/2.0'
                })

            with urllib.request.urlopen(req_obj, timeout=8) as resp:
                parsed = json.loads(resp.read().decode('utf-8'))
                model_names = []
                if 'models' in parsed and isinstance(parsed['models'], list):
                    for m in parsed['models']:
                        name = m.get('name') or m.get('id')
                        if name:
                            if name.startswith('models/'):
                                name = name[7:]
                            if any(k in name for k in ['gemini', 'flash', 'pro', 'llama']):
                                model_names.append(name)
                elif 'data' in parsed and isinstance(parsed['data'], list):
                    for m in parsed['data']:
                        name = m.get('id') or m.get('name')
                        if name:
                            model_names.append(name)

                if model_names:
                    self._send_json_response(200, {
                        'ok': True,
                        'models': model_names[:30],
                        'source': 'live_provider'
                    })
                    return

        except Exception as e:
            print(f"[Proxy Models Fallback]: {e}", file=sys.stderr)

        self._send_json_response(200, {
            'ok': True,
            'models': defaults,
            'source': 'default_catalogue'
        })

    def handle_chat(self):
        req = self._read_json_body()
        provider = req.get('provider', 'nvidia').lower()
        api_key = req.get('apiKey', '').strip()
        model = req.get('model', '').strip()
        messages = req.get('messages', [])
        temperature = float(req.get('temperature', 0.2))
        max_tokens = int(req.get('maxTokens', 900))
        base_url = req.get('baseUrl', '').strip() or PROVIDER_URLS.get(provider, '')

        if not api_key and provider != 'ollama':
            self._send_json_response(400, {
                'ok': False,
                'error': 'API key required'
            })
            return

        try:
            # Special handling for Gemini API
            if provider == 'gemini':
                endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
                payload = {
                    'model': model or 'gemini-2.0-flash',
                    'messages': messages,
                    'temperature': temperature,
                    'max_tokens': max_tokens
                }
                headers = {
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json'
                }
                post_bytes = json.dumps(payload).encode('utf-8')
                req_obj = urllib.request.Request(endpoint, data=post_bytes, headers=headers, method='POST')
                try:
                    with urllib.request.urlopen(req_obj, timeout=35) as resp:
                        data = json.loads(resp.read().decode('utf-8'))
                        content = data['choices'][0]['message']['content'].strip()
                        self._send_json_response(200, {
                            'ok': True,
                            'content': content,
                            'model': data.get('model', model),
                            'provider': 'gemini'
                        })
                        return
                except urllib.error.HTTPError:
                    # Fallback to native generateContent endpoint
                    clean_model = model or 'gemini-2.0-flash'
                    if clean_model.startswith('models/'):
                        clean_model = clean_model[7:]
                    native_url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent?key={api_key}"
                    user_prompt = ""
                    for m in messages:
                        user_prompt += f"{m.get('role', '').upper()}: {m.get('content', '')}\n\n"
                    native_payload = {
                        "contents": [{"parts": [{"text": user_prompt}]}],
                        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}
                    }
                    req_native = urllib.request.Request(native_url, data=json.dumps(native_payload).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
                    with urllib.request.urlopen(req_native, timeout=35) as resp_nat:
                        nat_data = json.loads(resp_nat.read().decode('utf-8'))
                        content = nat_data['candidates'][0]['content']['parts'][0]['text'].strip()
                        self._send_json_response(200, {
                            'ok': True,
                            'content': content,
                            'model': clean_model,
                            'provider': 'gemini'
                        })
                        return

            # All other providers (NVIDIA NIM, Groq, OpenAI, OpenRouter, Ollama, Custom)
            endpoint = f"{base_url.rstrip('/')}/chat/completions"
            payload = {
                'model': model or (DEFAULT_MODELS.get(provider, [''])[0]),
                'messages': messages,
                'temperature': temperature,
                'max_tokens': max_tokens
            }
            headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'Velostat-Plantar-Diagnostics/2.0'
            }
            if api_key:
                headers['Authorization'] = f'Bearer {api_key}'

            post_bytes = json.dumps(payload).encode('utf-8')
            req_obj = urllib.request.Request(endpoint, data=post_bytes, headers=headers, method='POST')

            with urllib.request.urlopen(req_obj, timeout=40) as resp:
                resp_text = resp.read().decode('utf-8')
                data = json.loads(resp_text)
                content = ''
                if 'choices' in data and len(data['choices']) > 0:
                    choice = data['choices'][0]
                    content = choice.get('message', {}).get('content', '')
                elif 'candidates' in data and len(data['candidates']) > 0:
                    cand = data['candidates'][0]
                    parts = cand.get('content', {}).get('parts', [])
                    if parts:
                        content = parts[0].get('text', '')

                self._send_json_response(200, {
                    'ok': True,
                    'content': content.strip(),
                    'model': data.get('model', model),
                    'provider': provider
                })

        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='ignore')
            print(f"[Proxy Chat HTTP Error {e.code}]: {err_body}", file=sys.stderr)
            self._send_json_response(e.code, {
                'ok': False,
                'error': f"Provider HTTP {e.code}: {err_body or e.reason}"
            })
        except Exception as e:
            print(f"[Proxy Chat Exception]: {e}", file=sys.stderr)
            self._send_json_response(500, {
                'ok': False,
                'error': f"Proxy server error: {str(e)}"
            })

def run():
    print(f"Starting Velostat Server with LLM Proxy on port {PORT}...", flush=True)
    http.server.HTTPServer.allow_reuse_address = True
    server_address = ('0.0.0.0', PORT)
    httpd = http.server.HTTPServer(server_address, DiagnosticProxyHandler)
    print(f"Server running at http://localhost:{PORT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.", flush=True)
        httpd.server_close()

if __name__ == '__main__':
    run()
