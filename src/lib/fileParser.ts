// 文件解析工具：支持 PDF、Word、PPT、图片 OCR
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import PizZip from 'pizzip';

// 配置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface ParseResult {
  text: string;
  filename: string;
  type: string;
}

/**
 * 解析 PDF 文件
 */
export async function parsePDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n\n';
  }

  return fullText.trim();
}

/**
 * 解析 Word 文档 (.docx)
 */
export async function parseWord(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

/**
 * 解析 PPT 文档 (.pptx)
 */
export async function parsePPT(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = new PizZip(arrayBuffer);

  let fullText = '';

  // 遍历所有 slide 文件
  const slideFiles = Object.keys(zip.files).filter(name =>
    name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
  );

  for (const slideName of slideFiles) {
    const slideXml = zip.files[slideName].asText();
    // 提取 <a:t> 标签中的文本
    const textMatches = slideXml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g);
    for (const match of textMatches) {
      fullText += match[1] + '\n';
    }
    fullText += '\n';
  }

  return fullText.trim();
}

/**
 * 解析文本文件 (TXT/MD)
 */
export async function parseText(file: File): Promise<string> {
  return await file.text();
}

/**
 * 图片 OCR（调用视觉模型）
 */
export async function parseImage(file: File, model: string): Promise<string> {
  // 压缩大图片
  const compressedBase64 = await compressAndEncodeImage(file);

  // 调用视觉模型 API
  const { chatOnce } = await import('./api');

  const response = await chatOnce(
    model,
    [
      {
        role: 'user',
        content: JSON.stringify([
          {
            type: 'image_url',
            image_url: { url: compressedBase64 }
          },
          {
            type: 'text',
            text: '请提取这张图片中的所有文字内容。如果是手写或印刷文档，请逐字转录；如果是图表或示意图，请描述其内容。'
          }
        ])
      }
    ] as any,
    0.3
  );

  return response;
}

/**
 * 压缩图片并转 base64（最大边 2048px）
 */
async function compressAndEncodeImage(file: File, maxSize: number = 2048): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // 计算缩放比例
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = (height / width) * maxSize;
            width = maxSize;
          } else {
            width = (width / height) * maxSize;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // 转为 base64，质量 0.9
        const base64 = canvas.toDataURL('image/jpeg', 0.9);
        resolve(base64);
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 统一解析入口
 */
export async function parseFile(file: File, model?: string): Promise<ParseResult> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  let text = '';

  try {
    if (ext === 'pdf') {
      text = await parsePDF(file);
    } else if (ext === 'docx') {
      text = await parseWord(file);
    } else if (ext === 'doc') {
      throw new Error('不支持旧版 .doc 格式，请转换为 .docx');
    } else if (ext === 'pptx') {
      text = await parsePPT(file);
    } else if (ext === 'ppt') {
      throw new Error('不支持旧版 .ppt 格式，请转换为 .pptx');
    } else if (['txt', 'md', 'markdown'].includes(ext || '')) {
      text = await parseText(file);
    } else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext || '')) {
      if (!model) {
        throw new Error('图片 OCR 需要指定支持视觉的模型');
      }
      text = await parseImage(file, model);
    } else {
      throw new Error(`不支持的文件格式: .${ext}`);
    }

    if (!text || text.length < 10) {
      throw new Error('文件解析失败或内容为空');
    }

    return {
      text,
      filename: file.name,
      type: ext || 'unknown'
    };
  } catch (error) {
    throw new Error(`解析 ${file.name} 失败: ${String(error)}`);
  }
}

/**
 * 检查文件大小限制
 */
export function validateFileSize(file: File, maxSizeMB: number = 10): void {
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > maxSizeMB) {
    throw new Error(`文件过大 (${sizeMB.toFixed(1)}MB)，最大支持 ${maxSizeMB}MB`);
  }
}

/**
 * 支持的文件类型
 */
export const SUPPORTED_EXTENSIONS = [
  'txt', 'md', 'markdown',
  'pdf',
  'doc', 'docx',
  'ppt', 'pptx',
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'
];

export const SUPPORTED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp'
];
