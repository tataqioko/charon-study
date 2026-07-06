// 大文件分块上传工具
// 大文件分块上传：8MB 分块 + 进度回调

const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB

export interface ChunkUploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  currentChunk: number;
  totalChunks: number;
}

/**
 * 将大文件分块读取并处理
 */
export async function processFileInChunks(
  file: File,
  onProgress: (progress: ChunkUploadProgress) => void
): Promise<ArrayBuffer> {
  const fileSize = file.size;

  // 小文件直接读取
  if (fileSize <= CHUNK_SIZE) {
    const buffer = await file.arrayBuffer();
    onProgress({
      loaded: fileSize,
      total: fileSize,
      percentage: 100,
      currentChunk: 1,
      totalChunks: 1,
    });
    return buffer;
  }

  // 大文件分块读取
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  const chunks: ArrayBuffer[] = [];
  let loaded = 0;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileSize);
    const blob = file.slice(start, end);

    const chunkBuffer = await blob.arrayBuffer();
    chunks.push(chunkBuffer);

    loaded += chunkBuffer.byteLength;

    onProgress({
      loaded,
      total: fileSize,
      percentage: Math.round((loaded / fileSize) * 100),
      currentChunk: i + 1,
      totalChunks,
    });
  }

  // 合并所有块
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
}
