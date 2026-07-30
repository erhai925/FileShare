import api from '../services/api'

/**
 * 文件下载
 *
 * 一律走浏览器原生下载（隐藏 <a> + href），不再用 fetch + blob()。
 * 原因：fetch+blob 必须把整个文件读进浏览器内存才开始写盘，几百 MB 的文件
 * 会在落盘阶段因内存压力中断，只留下 .crdownload 临时文件。原生下载由浏览器
 * 直接流式写盘，不占 JS 内存，且支持断点续传。
 *
 * 代价是失去「另存为」弹窗（文件直接进默认下载夹）——这是有意的取舍。
 *
 * 浏览器发起的下载请求带不上 Authorization 头，故先用已登录身份换取一次性
 * 令牌，再把令牌放到 URL 上。
 */

/** 用隐藏的 <a> 触发浏览器原生下载 */
function triggerNativeDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.style.display = 'none'
  // download 属性留空：文件名由服务端 Content-Disposition 决定，
  // 且跨源时该属性会被忽略，交给服务端更可靠
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/** 下载单个文件。失败时抛错，由调用方提示 */
export async function downloadFile(fileId: number | string) {
  const res = await api.post('/files/download-token', { fileId: Number(fileId) }) as {
    success?: boolean
    data?: { token?: string }
    message?: string
  }
  const token = res?.data?.token
  if (!res?.success || !token) {
    throw new Error(res?.message || '获取下载链接失败')
  }
  triggerNativeDownload(`/api/files/download/${fileId}?token=${encodeURIComponent(token)}`)
}

export interface BatchDownloadResult {
  /** 请求的文件数 */
  total: number
  /** 实际打包的文件数 */
  included: number
  /** 因无权限被跳过的文件数 */
  skipped: number
}

/** 批量下载：服务端流式打包成 zip */
export async function downloadFilesAsZip(fileIds: Array<number | string>): Promise<BatchDownloadResult> {
  const ids = fileIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (ids.length === 0) throw new Error('请选择要下载的文件')

  const res = await api.post('/files/batch-download-token', { fileIds: ids }) as {
    success?: boolean
    data?: { token?: string; total?: number; included?: number; skipped?: number }
    message?: string
  }
  const token = res?.data?.token
  if (!res?.success || !token) {
    throw new Error(res?.message || '获取批量下载链接失败')
  }
  triggerNativeDownload(`/api/files/batch-download?token=${encodeURIComponent(token)}`)
  return {
    total: res.data?.total ?? ids.length,
    included: res.data?.included ?? ids.length,
    skipped: res.data?.skipped ?? 0
  }
}
