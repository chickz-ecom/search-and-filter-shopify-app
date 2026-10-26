// Stream-parse JSONL (kết quả bulk có thể vài trăm MB) — không đọc cả file vào RAM.

export type ByteSource = AsyncIterable<Uint8Array | string> | ReadableStream<Uint8Array>;

async function* chunksOf(src: ByteSource): AsyncIterable<Uint8Array | string> {
  if (typeof (src as ReadableStream).getReader === "function") {
    const reader = (src as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    yield* src as AsyncIterable<Uint8Array | string>;
  }
}

export async function* parseJsonl<T = unknown>(src: ByteSource): AsyncIterable<T> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of chunksOf(src)) {
    buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  buf += decoder.decode();
  const rest = buf.trim();
  if (rest) yield JSON.parse(rest) as T;
}
