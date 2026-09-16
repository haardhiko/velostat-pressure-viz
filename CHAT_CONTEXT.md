# Velostat Pressure Visualization Project — Chat & Context Summary

## 1. Project Overview & Background
- **Project Directory**: `C:\Users\haard\.gemini\antigravity\scratch\velostat-pressure-viz`
- **Goal**: Create a web application that connects directly to an ESP32 microcontroller via USB Serial to visualize physical pressure from a DIY Velostat sensor.
- **Hardware Architecture**:
  - Material: Aluminum strip conductors sandwiching Velostat piezoresistive film.
  - Sensor count: Single prototype pressure sensor (1 touch point).
  - Microcontroller: ESP32 Dev Board.
  - Connection: Wired USB serial link directly to laptop.
  - Pinout: Sensor connected to **GPIO32** (ADC1_CH4) and GND with a pull-up / voltage-divider resistor to 3.3V.

---

## 2. Evolution & Chat Milestones

### Phase 1: Removal of Foot Sole & Presets
- The original codebase contained an SVG anatomical sole contour (toes, arch, heel) with gait simulations (heel strike, foot flat, toe-off) and brush drawing tools.
- **Changes**:
  - Removed all pre-given foot presets, gait simulation buttons, brush sliders, and anatomical SVG clip-paths.
  - Replaced the sole contour with a clean square sensor pad visualizer.

### Phase 2: Switch to Wired USB Serial (Web Serial API)
- Initially, communication was planned over WebSocket / Wi-Fi (`ws://192.168.x.x`).
- **User requirement**: The ESP32 is plugged directly into the laptop via USB cable.
- **Implementation**:
  - Switched from WebSocket to the native **Web Serial API** (`navigator.serial`).
  - Allows Google Chrome / Microsoft Edge to open the ESP32's COM port directly without installing any local Python / Node.js bridge server.
  - Configurable baud rate (default: `115200`).

### Phase 3: Hardware Verification & ESP32 Firmware
- Clarified hardware: The prototype is a single sensor sandwich (aluminum + velostat + aluminum) with a pull-up resistor.
- Created `esp32_velostat.ino`:
  - Reads analog voltage on `GPIO32` (12-bit ADC: `0–4095`).
  - Samples and averages readings using an exponential moving filter to eliminate electrical noise.
  - Transmits one clean integer value per line (`Serial.println`) at 115200 baud (~20 Hz).

### Phase 4: Big Square Heatmap Visualizer (Blue to Red)
- **User Feedback**: Revert from the circular gauge to **one big square heatmap pad**.
- **Behavior**:
  - **Idle (0% Touch)**: Dark sensor pad with subtle matrix grid texture.
  - **Light Touch**: Turns **Blue / Cyan**.
  - **Medium Pressure**: Shifts through **Green to Yellow**.
  - **Heavy / Maximum Pressure**: Blazes to **Intense Red** with glowing pressure bloom rings.
  - Uses linear interpolation (`lerp`) so changes animate with smooth easing rather than sudden jumps.

### Phase 5: Calibration & Interactive Enhancements
- **Invert ADC Toggle**: When Velostat resistance drops during a squeeze, voltage drops if wired to GND. The "Invert ADC" toggle (or auto-detection) ensures pressing always increases pressure.
- **Auto-Calibration Wizard**: Press the "Auto-Calibrate" button; it records 1.5s of resting baseline and 2s of firm press to automatically map your sensor's exact min/max voltage range.
- **Interactive Dragging**: You can click and drag directly on the square pad in the web browser to test moving the pressure hotspot in real time.

---

## 3. File Structure & Roles

| File | Purpose |
|---|---|
| [`index.html`](file:///C:/Users/haard/.gemini/antigravity/scratch/velostat-pressure-viz/index.html) | Main HTML structure: Heatmap canvas, legend bar, serial connection panel, live statistics, calibration & test controls. |
| [`script.js`](file:///C:/Users/haard/.gemini/antigravity/scratch/velostat-pressure-viz/script.js) | Core logic: Canvas radial gradient rendering (Blue-to-Red), Web Serial API parser, lerp animation loop, auto-calibration wizard, interactive canvas dragging. |
| [`style.css`](file:///C:/Users/haard/.gemini/antigravity/scratch/velostat-pressure-viz/style.css) | Dark cyberpunk theme styles, responsive layout, status badges, glow effects. |
| [`esp32_velostat.ino`](file:///C:/Users/haard/.gemini/antigravity/scratch/velostat-pressure-viz/esp32_velostat.ino) | Arduino C++ sketch for ESP32 with multi-sample filtering and ADC reading on GPIO32. |

---

## 4. Hardware Wiring Diagram

```
       3.3V (VCC)
           |
         [10kΩ Resistor]
           |
           +----------------> ESP32 GPIO32 (Analog ADC)
           |
    [Aluminum Strip 1]
    [Velostat Layer  ]  <--- When pressed, resistance drops!
    [Aluminum Strip 2]
           |
          GND
```

---

## 5. How to Run & Use

1. **Start the Web Server**:
   The local server is running on port **8080**:
   ```
   http://localhost:8080
   ```
2. **Flash the ESP32**:
   - Open [`esp32_velostat.ino`](file:///C:/Users/haard/.gemini/antigravity/scratch/velostat-pressure-viz/esp32_velostat.ino) in Arduino IDE.
   - Select Board: **ESP32 Dev Module**.
   - Upload sketch via USB.
3. **Connect Web App**:
   - Open `http://localhost:8080` in **Chrome** or **Edge**.
   - Ensure baud is set to `115200`.
   - Click **Connect** and select your ESP32 COM port from the prompt.
4. **Calibrate**:
   - Click **Auto-Calibrate**: release the sensor for 1.5s, then press firmly for 2s. The app automatically determines if the reading should be inverted and fits your sensor's exact min and max ADC range.
5. **Interact**:
   - Light press = **Cool Blue / Cyan glow**.
   - Hard press = **Hot Red glow**.
   - You can also click and drag directly on the visual pad to simulate touch points.
