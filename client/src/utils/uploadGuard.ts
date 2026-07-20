import type { ModalStaticFunctions } from 'antd/es/modal/confirm'

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
