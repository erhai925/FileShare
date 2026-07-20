import type { ModalStaticFunctions } from 'antd/es/modal/confirm'
import type { MessageInstance } from 'antd/es/message/interface'
import type { AxiosProgressEvent } from 'axios'

/** 超过该大小（50MB）时提示改用大文件（分块）上传 */
export const LARGE_FILE_THRESHOLD_BYTES = 50 * 1024 * 1024
/** 普通上传硬上限（10GB，与服务端 files.js 的 MAX_FILE_SIZE 对齐），超过必须走分块上传 */
export const NORMAL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024 * 1024

export type UploadMode = 'normal' | 'chunk'

type ModalApi = Pick<ModalStaticFunctions, 'confirm'>

export function fmtFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 判定该文件走普通上传还是大文件上传。
 * - 小于阈值：直接普通上传，不打扰用户
 * - 超过 10GB 硬上限：普通上传必然失败，不询问直接转大文件上传
 * - 介于两者之间：弹框询问，默认推荐大文件上传
 *
 * 必须传入 App.useApp() 的 modal 实例：静态 Modal.confirm 不消费 context，
 * 在 <App> 包裹下会告警且可能不按预期显形。
 */
export function askUploadMode(file: File, modalApi: ModalApi): Promise<UploadMode> {
  if (file.size < LARGE_FILE_THRESHOLD_BYTES) return Promise.resolve<UploadMode>('normal')
  if (file.size >= NORMAL_UPLOAD_MAX_BYTES) return Promise.resolve<UploadMode>('chunk')
  return new Promise<UploadMode>((resolve) => {
    modalApi.confirm({
      title: '文件较大，建议使用大文件上传',
      content: `当前文件 ${fmtFileSize(file.size)}，超过普通上传建议上限（${fmtFileSize(LARGE_FILE_THRESHOLD_BYTES)}）。大文件上传按分块传输并支持断点续传，网络中断后可继续，不必从头再来。`,
      okText: '使用大文件上传（推荐）',
      cancelText: '仍用普通上传',
      onOk: () => resolve('chunk'),
      onCancel: () => resolve('normal')
    })
  })
}

/* ------------------------------------------------------------------ *
 * 上传进度反馈与并发防重
 * 起因：普通上传的 customRequest 从不调用 onProgress，进度条恒为 0%，
 * 用户以为没反应就反复点，同一份文件多次入库。
 * ------------------------------------------------------------------ */

/** 同名同大小视为同一份文件，用于并发去重与 message 的 key */
export function inflightKey(file: File) {
  return `upload:${file.name}:${file.size}`
}

/** 正在传输中的文件集合（单页应用，模块级即可） */
const inflight = new Set<string>()

/** 登记一次上传；已在传输中则返回 false，调用方应拒绝本次重复提交 */
export function beginInflight(file: File): boolean {
  const key = inflightKey(file)
  if (inflight.has(key)) return false
  inflight.add(key)
  return true
}

export function endInflight(file: File) {
  inflight.delete(inflightKey(file))
}

/**
 * 把 axios 的传输进度回报为百分比，同时用常驻 message 给出可见反馈。
 * 封顶 99%：字节传完后服务端还要落盘/加密，此时显示"服务端处理中"，
 * 避免进度条到 100% 却迟迟不结束、让人再次以为卡死。
 */
export function reportUploadProgress(
  e: AxiosProgressEvent, file: File, messageApi: MessageInstance, key: string
): number {
  const percent = e.total ? Math.min(99, Math.round((e.loaded / e.total) * 100)) : 0
  messageApi.open({
    key,
    type: 'loading',
    duration: 0,
    content: percent >= 99
      ? `${file.name} 传输完成，服务端处理中，请勿重复上传…`
      : `正在上传 ${file.name} ${percent}%`
  })
  return percent
}

/** 收尾：用同一个 key 覆盖掉常驻的 loading 提示 */
export function finishUploadProgress(
  messageApi: MessageInstance, key: string, ok: boolean, content: string
) {
  messageApi.open({ key, type: ok ? 'success' : 'error', content, duration: ok ? 2 : 5 })
}

/**
 * 生成一个「一批只问一次」的判定器：一次多选多个大文件时，antd 会对同一批
 * 传入同一个 fileList 引用，据此复用同一个决策 Promise，避免弹一串确认框。
 */
export function createBatchUploadModeAsker() {
  let cache: { list: unknown; promise: Promise<UploadMode> } | null = null
  return (file: File, fileList: unknown, modalApi: ModalApi): Promise<UploadMode> => {
    if (file.size < LARGE_FILE_THRESHOLD_BYTES) return Promise.resolve<UploadMode>('normal')
    if (cache && cache.list === fileList) return cache.promise
    const promise = askUploadMode(file, modalApi)
    cache = { list: fileList, promise }
    return promise
  }
}
