/*
 *  Velostat Pressure Sensor — ESP32 Serial Output
 *  
 *  Wiring:
 *    VCC (3.3V) ——[ R (10kΩ) ]——+—— GPIO32
 *                                |
 *                           [ Velostat ]
 *                                |
 *                               GND
 *
 *  Prints the raw ADC value (0–4095) over Serial at 115200 baud.
 *  The web app reads these lines and displays the pressure.
 */

const int SENSOR_PIN = 32;        // GPIO32 (ADC1_CH4)
const int BAUD_RATE  = 115200;
const int READ_DELAY = 50;        // ms between reads (~20 Hz)

// Optional: smoothing to reduce noise
const int   NUM_SAMPLES = 5;      // average this many reads per output
const float ALPHA       = 0.3;    // exponential smoothing (0.0–1.0)

float smoothedValue = 0;

void setup() {
  Serial.begin(BAUD_RATE);
  analogReadResolution(12);       // 12-bit ADC: 0–4095
  analogSetAttenuation(ADC_11db); // Full 0–3.3V range

  // Warm up with a few reads
  for (int i = 0; i < 10; i++) {
    analogRead(SENSOR_PIN);
    delay(10);
  }
  smoothedValue = analogRead(SENSOR_PIN);
}

void loop() {
  // Average multiple samples to reduce noise
  long sum = 0;
  for (int i = 0; i < NUM_SAMPLES; i++) {
    sum += analogRead(SENSOR_PIN);
    delayMicroseconds(200);
  }
  float raw = (float)sum / NUM_SAMPLES;

  // Exponential moving average
  smoothedValue = ALPHA * raw + (1.0 - ALPHA) * smoothedValue;

  // Print as integer (0–4095)
  Serial.println((int)smoothedValue);

  delay(READ_DELAY);
}
