let context = null, prepared = null;
export function prepareVoiceBuffer() {
  if (!prepared) {
    context = new AudioContext({ sampleRate: 48e3, latencyHint: "interactive" });
    prepared = context.suspend().then(()=>context.audioWorklet.addModule("/voice-preroll-worklet.js")).catch((e) => {
      prepared = null;
      void context?.close();
      context = null;
      throw e;
    });
  }
  return prepared;
}
export async function voiceBuffer(id, signal, metric) {
  await prepareVoiceBuffer();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const ctx = context, destination = ctx.createMediaStreamDestination();
  destination.channelCount = 1;
  const node = new AudioWorkletNode(ctx, "ptt-preroll", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1 });
  node.connect(destination);
  destination.stream.getAudioTracks().forEach((t) => t.enabled = false);
  node.port.postMessage({ type: "reset", id });
  let closed = false, started = false, source = null, drained = () => {
  }, first = () => {
  };
  const firstFrame = new Promise((r) => first = r), at = performance.now();
  node.port.onmessage = ({ data: d }) => {
    if (d.id !== id) return;
    if (d.type === "first-frame") {
      metric("pttCaptureFirstFrameMs", performance.now() - at);
      first();
    }
    if (d.type === "drained") drained();
    if (d.type === "overflow") {
      metric("pttCaptureOverflow", 1);
      void stop(false);
    }
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    source?.disconnect();
    node.disconnect();
    node.port.close();
    destination.stream.getTracks().forEach((t) => t.stop());
    void ctx.suspend();
    signal.removeEventListener("abort", abort);
  };
  const stop = async (drain = false) => {
    if (closed) return;
    node.port.postMessage({ type: "stop", id, drain: drain && started });
    if (drain && started) {
      const elapsed = performance.now();
      await new Promise((r) => {
        const timeout = setTimeout(r, 350);
        drained = () => {
          clearTimeout(timeout);
          r();
        };
      });
      metric("pttCaptureDrainMs", performance.now() - elapsed);
    }
    cleanup();
  };
  const abort = () => {
    void stop(false);
  };
  signal.addEventListener("abort", abort, { once: true });
  await ctx.resume();
  if (signal.aborted) {
    cleanup();
    throw new DOMException("Aborted", "AbortError");
  }
  return {
    stream: destination.stream,
    firstFrame,
    attach(stream) {
      source = ctx.createMediaStreamSource(stream);
      source.connect(node);
    },
    push(values) {
      if (!closed) node.port.postMessage({ type: "push", id, values }, [values.buffer]);
    },
    commit() {
      if (closed || signal.aborted) return;
      started = true;
      node.port.postMessage({ type: "commit", id });
    },
    stop
  };
}
export async function browserPressCapture(id, signal, microphone, metric, stopInput) {
  const input = microphone();
  void input.catch(() => {
  });
  let buffer = null, stream = null;
  try {
    buffer = await voiceBuffer(id, signal, metric);
    stream = await input;
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    stream.getAudioTracks().forEach((t) => t.enabled = true);
    buffer.attach(stream);
    return { stream: buffer.stream, commit: buffer.commit, stop: async (drain) => {
      stopInput();
      await buffer.stop(drain);
    } };
  } catch (e) {
    void buffer?.stop(false);
    void input.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {
    });
    throw e;
  }
}
