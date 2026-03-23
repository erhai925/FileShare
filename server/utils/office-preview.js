const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');

const execFileAsync = promisify(execFile);

let resolvedLibreOfficeCommand = null;
const conversionJobs = new Map();
let cleanupPromise = null;

const DEFAULT_PREVIEW_CACHE_LIMIT_MB = 2048;
const DEFAULT_PREVIEW_CACHE_TARGET_MB = 1536;

function getLibreOfficeCandidates() {
  return [
    process.env.LIBREOFFICE_PATH,
    'soffice',
    'libreoffice',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/snap/bin/libreoffice'
  ].filter(Boolean);
}

async function resolveLibreOfficeCommand() {
  if (resolvedLibreOfficeCommand) {
    return resolvedLibreOfficeCommand;
  }

  const candidates = getLibreOfficeCandidates();
  for (const command of candidates) {
    try {
      await execFileAsync(command, ['--version'], {
        timeout: 5000,
        windowsHide: true
      });
      resolvedLibreOfficeCommand = command;
      return command;
    } catch (_) {
      // 尝试下一个候选命令
    }
  }

  throw new Error('未找到 LibreOffice/soffice，请先在服务器安装 LibreOffice，或通过 LIBREOFFICE_PATH 指定命令路径');
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function getPreviewCacheLimitBytes() {
  const mb = parseInt(process.env.OFFICE_PREVIEW_CACHE_LIMIT_MB || '', 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_PREVIEW_CACHE_LIMIT_MB) * 1024 * 1024;
}

function getPreviewCacheTargetBytes(limitBytes) {
  const mb = parseInt(process.env.OFFICE_PREVIEW_CACHE_TARGET_MB || '', 10);
  const configured = (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_PREVIEW_CACHE_TARGET_MB) * 1024 * 1024;
  return Math.min(configured, limitBytes);
}

function buildCacheKey(fileHash, sourceBuffer) {
  if (fileHash && typeof fileHash === 'string') {
    return fileHash;
  }
  return crypto.createHash('sha1').update(sourceBuffer).digest('hex');
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

async function findGeneratedPdf(outputDir) {
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const pdfEntry = entries.find(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'));
  return pdfEntry ? path.join(outputDir, pdfEntry.name) : null;
}

async function cleanupPreviewCache(previewRoot, { force = false } = {}) {
  if (cleanupPromise) {
    return cleanupPromise;
  }

  cleanupPromise = (async () => {
    try {
      await ensureDir(previewRoot);
      const entries = await fs.readdir(previewRoot, { withFileTypes: true });
      const files = [];
      let totalSize = 0;

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) {
          continue;
        }
        const fullPath = path.join(previewRoot, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          files.push({
            path: fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs
          });
          totalSize += stat.size;
        } catch (_) {
          // 文件可能已被并发删除，忽略即可
        }
      }

      const limitBytes = getPreviewCacheLimitBytes();
      if (!force && totalSize <= limitBytes) {
        return;
      }

      const targetBytes = getPreviewCacheTargetBytes(limitBytes);
      files.sort((a, b) => a.mtimeMs - b.mtimeMs);

      for (const file of files) {
        if (totalSize <= targetBytes) {
          break;
        }
        try {
          await fs.unlink(file.path);
          totalSize -= file.size;
        } catch (_) {
          // 已被其他请求删除或占用，忽略
        }
      }
    } finally {
      cleanupPromise = null;
    }
  })();

  return cleanupPromise;
}

function sanitizeBaseName(originalName, sourceExt) {
  const rawBase = path.basename(originalName || `source${sourceExt}`, sourceExt || '').trim() || 'source';
  const safeBase = rawBase.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'source';
  return `${safeBase}${sourceExt}`;
}

async function getPresentationCacheInfo({ sourceBuffer, fileHash }) {
  const previewRoot = path.join(os.tmpdir(), 'fileshare-office-preview');
  await ensureDir(previewRoot);
  await cleanupPreviewCache(previewRoot);
  const cacheKey = buildCacheKey(fileHash, sourceBuffer);
  const cachedPdfPath = path.join(previewRoot, `${cacheKey}.pdf`);
  return { previewRoot, cacheKey, cachedPdfPath };
}

async function convertPresentationToPdfNow({ sourceBuffer, sourceExt, fileHash, originalName }) {
  const { cacheKey, cachedPdfPath } = await getPresentationCacheInfo({ sourceBuffer, fileHash });
  if (await fileExists(cachedPdfPath)) {
    return cachedPdfPath;
  }

  const previewRoot = path.dirname(cachedPdfPath);
  const workDir = path.join(previewRoot, `job-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);
  const outputDir = path.join(workDir, 'out');
  const profileDir = path.join(workDir, 'profile');
  const homeDir = path.join(workDir, 'home');
  const sourceFileName = sanitizeBaseName(originalName, sourceExt);
  const sourcePath = path.join(workDir, sourceFileName);
  const sourceUrl = pathToFileURL(sourcePath).href;
  const timeoutMs = parseInt(process.env.OFFICE_CONVERT_TIMEOUT_MS, 10) || 120000;

  await ensureDir(outputDir);
  await ensureDir(profileDir);
  await ensureDir(homeDir);
  await fs.writeFile(sourcePath, sourceBuffer);

  try {
    const command = await resolveLibreOfficeCommand();
    const stat = await fs.stat(sourcePath);
    const { stdout, stderr } = await execFileAsync(
      command,
      [
        '--headless',
        '--nologo',
        '--nodefault',
        '--nolockcheck',
        '--nofirststartwizard',
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to',
        'pdf:impress_pdf_Export',
        '--outdir',
        outputDir,
        sourceUrl
      ],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        cwd: workDir,
        env: {
          ...process.env,
          HOME: homeDir,
          TMPDIR: workDir,
          TMP: workDir,
          TEMP: workDir
        }
      }
    );

    const generatedPdfPath = await findGeneratedPdf(outputDir);
    if (!generatedPdfPath || !(await fileExists(generatedPdfPath))) {
      const detailParts = [];
      detailParts.push(`sourcePath: ${sourcePath}`);
      detailParts.push(`sourceSize: ${stat.size}`);
      if (stdout && stdout.trim()) detailParts.push(`stdout: ${stdout.trim()}`);
      if (stderr && stderr.trim()) detailParts.push(`stderr: ${stderr.trim()}`);
      throw new Error(detailParts.length > 0 ? `LibreOffice 未生成 PDF 文件；${detailParts.join(' | ')}` : 'LibreOffice 未生成 PDF 文件');
    }

    await fs.copyFile(generatedPdfPath, cachedPdfPath);
    await cleanupPreviewCache(previewRoot);
    return cachedPdfPath;
  } catch (error) {
    const detail = error && error.message ? error.message : '未知错误';
    throw new Error(`PPT 转 PDF 失败: ${detail}`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getPresentationPreviewStatus({ sourceBuffer, fileHash }) {
  const { cacheKey, cachedPdfPath } = await getPresentationCacheInfo({ sourceBuffer, fileHash });
  if (await fileExists(cachedPdfPath)) {
    return {
      cacheKey,
      status: 'ready',
      pdfPath: cachedPdfPath
    };
  }

  const existingJob = conversionJobs.get(cacheKey);
  if (existingJob) {
    return {
      cacheKey,
      status: existingJob.status,
      pdfPath: existingJob.pdfPath || null,
      error: existingJob.error || null
    };
  }

  return {
    cacheKey,
    status: 'idle',
    pdfPath: null,
    error: null
  };
}

async function enqueuePresentationToPdf(params) {
  const { cacheKey, cachedPdfPath } = await getPresentationCacheInfo(params);
  if (await fileExists(cachedPdfPath)) {
    conversionJobs.set(cacheKey, {
      status: 'ready',
      pdfPath: cachedPdfPath,
      error: null,
      updatedAt: Date.now()
    });
    return {
      cacheKey,
      status: 'ready',
      pdfPath: cachedPdfPath
    };
  }

  const existingJob = conversionJobs.get(cacheKey);
  if (existingJob && existingJob.status === 'converting') {
    return {
      cacheKey,
      status: 'converting',
      pdfPath: null,
      error: null
    };
  }

  const job = {
    status: 'converting',
    pdfPath: null,
    error: null,
    updatedAt: Date.now(),
    promise: null
  };
  conversionJobs.set(cacheKey, job);

  job.promise = convertPresentationToPdfNow(params)
    .then((pdfPath) => {
      job.status = 'ready';
      job.pdfPath = pdfPath;
      job.error = null;
      job.updatedAt = Date.now();
      return pdfPath;
    })
    .catch((error) => {
      job.status = 'failed';
      job.pdfPath = null;
      job.error = error && error.message ? error.message : '转换失败';
      job.updatedAt = Date.now();
      return null;
    });

  return {
    cacheKey,
    status: 'converting',
    pdfPath: null,
    error: null
  };
}

async function convertPresentationToPdf(params) {
  const status = await enqueuePresentationToPdf(params);
  if (status.status === 'ready' && status.pdfPath) {
    return status.pdfPath;
  }
  const activeJob = conversionJobs.get(status.cacheKey);
  if (!activeJob || !activeJob.promise) {
    throw new Error('PPT 转 PDF 任务未正确启动');
  }
  return activeJob.promise;
}

module.exports = {
  convertPresentationToPdf,
  enqueuePresentationToPdf,
  getPresentationPreviewStatus,
  cleanupPreviewCache,
  resolveLibreOfficeCommand
};
