import { createNoiseGenerator } from "./noise.js";

class NoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.generator = createNoiseGenerator(options.processorOptions.noise, sampleRate);
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === "stop") { this.stopped = true; this.port.close(); }
    };
  }

  process(_inputs, outputs) {
    if (this.stopped) return false;
    const channels = outputs[0];
    if (channels?.[0]) {
      this.generator.fill(channels[0]);
      for (let i = 1; i < channels.length; i++) channels[i].set(channels[0]);
    }
    return true;
  }
}

registerProcessor("practice-noise", NoiseProcessor);
