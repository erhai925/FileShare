import api from './api'

export interface WikiSpace {
  id: number
  name: string
  type: 'team' | 'department' | 'personal' | 'project'
  description?: string
  owner_id: number
  owner_name?: string
  page_count?: number
  last_updated_at?: string
  created_at: string
}

export interface WikiPage {
  id: number
  space_id: number
  parent_id: number | null
  title: string
  slug: string
  content?: string
  draft_content?: string
  status: 'draft' | 'published'
  template: string
  sort_order: number
  view_count: number
  version: number
  archived_at: string | null
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
  tags?: { id: number; name: string; color: string }[]
  is_favorited?: boolean
  backlinks?: { id: number; title: string; slug: string }[]
  attachments?: any[]
  permissions?: { read: boolean; write: boolean; delete: boolean; comment: boolean; download: boolean }
  space_name?: string
}

export interface WikiVersion {
  id: number
  version: number
  title: string
  content?: string
  change_note: string | null
  created_by: number
  created_at: string
  author_name?: string
  author_real_name?: string
}

export interface WikiTreeNode extends WikiPage {
  children?: WikiTreeNode[]
}

export interface WikiSearchResult {
  id: number
  space_id: number
  title: string
  slug: string
  snippet: string
  updated_at: string
  view_count: number
  space_name: string
  author_name: string
}

interface ApiResp<T> { success: boolean; data: T; message?: string }
interface PaginatedResp<T> extends ApiResp<T> { pagination?: { page: number; pageSize: number; total: number; totalPages: number } }

// ==================== 知识库 ====================
export const wikiApi = {
  listSpaces: (type?: string) =>
    api.get<any, ApiResp<WikiSpace[]>>('/wiki/spaces', { params: { type } }),
  createSpace: (data: { name: string; type: string; description?: string; parentId?: number }) =>
    api.post<any, ApiResp<{ spaceId: number }>>('/wiki/spaces', data),
  getSpace: (id: number) =>
    api.get<any, ApiResp<WikiSpace>>(`/wiki/spaces/${id}`),
  updateSpace: (id: number, data: Partial<WikiSpace>) =>
    api.put<any, ApiResp<null>>(`/wiki/spaces/${id}`, data),
  deleteSpace: (id: number) =>
    api.delete<any, ApiResp<null>>(`/wiki/spaces/${id}`),

  // 树
  getTree: (spaceId: number, opts?: { includeArchived?: boolean; includeDraft?: boolean }) =>
    api.get<any, ApiResp<WikiPage[]>>(`/wiki/spaces/${spaceId}/tree`, {
      params: {
        includeArchived: opts?.includeArchived ? '1' : undefined,
        includeDraft: opts?.includeDraft ? '1' : undefined
      }
    }),

  // 页面
  createPage: (data: { spaceId: number; parentId?: number | null; title: string; content?: string; template?: string; tags?: string[]; status?: 'draft' | 'published' }) =>
    api.post<any, ApiResp<{ pageId: number; slug: string }>>('/wiki/pages', data),
  getPage: (id: number, includeDraft = false) =>
    api.get<any, ApiResp<WikiPage>>(`/wiki/pages/${id}`, { params: { includeDraft: includeDraft ? '1' : undefined } }),
  updatePage: (id: number, data: { title?: string; content?: string; tags?: string[]; expectedVersion: number; changeNote?: string }) =>
    api.put<any, ApiResp<{ version: number }>>(`/wiki/pages/${id}`, data),
  saveDraft: (id: number, data: { title?: string; content?: string }) =>
    api.put<any, ApiResp<null>>(`/wiki/pages/${id}/draft`, data),
  publishPage: (id: number, changeNote?: string) =>
    api.post<any, ApiResp<{ version: number }>>(`/wiki/pages/${id}/publish`, { changeNote }),
  deletePage: (id: number) =>
    api.delete<any, ApiResp<{ deletedCount: number }>>(`/wiki/pages/${id}`),
  permanentDeletePage: (id: number) =>
    api.delete<any, ApiResp<null>>(`/wiki/pages/${id}/permanent`),
  restorePage: (id: number) =>
    api.post<any, ApiResp<{ restoredCount: number; parentReset: boolean }>>(`/wiki/pages/${id}/restore`),
  movePage: (id: number, data: { parentId?: number | null; sortOrder?: number }) =>
    api.post<any, ApiResp<null>>(`/wiki/pages/${id}/move`, data),
  archivePage: (id: number) => api.post<any, ApiResp<null>>(`/wiki/pages/${id}/archive`),
  unarchivePage: (id: number) => api.post<any, ApiResp<null>>(`/wiki/pages/${id}/unarchive`),

  // 版本
  listVersions: (pageId: number) =>
    api.get<any, ApiResp<WikiVersion[]>>(`/wiki/pages/${pageId}/versions`),
  getVersion: (pageId: number, version: number) =>
    api.get<any, ApiResp<WikiVersion>>(`/wiki/pages/${pageId}/versions/${version}`),
  diffVersions: (pageId: number, from: number, to: number) =>
    api.get<any, ApiResp<{ from: WikiVersion; to: WikiVersion }>>(`/wiki/pages/${pageId}/diff`, { params: { from, to } }),
  rollback: (pageId: number, version: number) =>
    api.post<any, ApiResp<{ version: number }>>(`/wiki/pages/${pageId}/rollback/${version}`),

  // 搜索
  search: (params: { q?: string; spaceId?: number; tag?: string; author?: number; from?: string; to?: string; page?: number; pageSize?: number }) =>
    api.get<any, PaginatedResp<WikiSearchResult[]>>('/wiki/search', { params }),

  // 评论
  listComments: (pageId: number) =>
    api.get<any, ApiResp<any[]>>(`/wiki/pages/${pageId}/comments`),
  addComment: (pageId: number, data: { content: string; parentId?: number; mentionedUsers?: number[] }) =>
    api.post<any, ApiResp<{ commentId: number }>>(`/wiki/pages/${pageId}/comments`, data),
  deleteComment: (commentId: number) =>
    api.delete<any, ApiResp<null>>(`/wiki/comments/${commentId}`),

  // 附件
  listAttachments: (pageId: number) =>
    api.get<any, ApiResp<any[]>>(`/wiki/pages/${pageId}/attachments`),
  attachFile: (pageId: number, fileId: number) =>
    api.post<any, ApiResp<null>>(`/wiki/pages/${pageId}/attachments`, { fileId }),
  detachFile: (pageId: number, fileId: number) =>
    api.delete<any, ApiResp<null>>(`/wiki/pages/${pageId}/attachments/${fileId}`),

  // 标签 / 收藏 / 浏览
  listTags: () => api.get<any, ApiResp<any[]>>('/wiki/tags'),
  getTagPages: (tagId: number) => api.get<any, ApiResp<any[]>>(`/wiki/tags/${tagId}/pages`),
  toggleFavorite: (pageId: number) => api.post<any, ApiResp<{ favorited: boolean }>>(`/wiki/pages/${pageId}/favorite`),
  listFavorites: () => api.get<any, ApiResp<any[]>>('/wiki/favorites'),
  recordView: (pageId: number) => api.post<any, ApiResp<{ counted: boolean }>>(`/wiki/pages/${pageId}/view`),
  popular: (spaceId?: number, limit?: number) => api.get<any, ApiResp<any[]>>('/wiki/popular', { params: { spaceId, limit } }),
  recent: () => api.get<any, ApiResp<any[]>>('/wiki/recent'),

  // 订阅
  listSubscriptions: () => api.get<any, ApiResp<any[]>>('/wiki/subscriptions'),
  subscribe: (targetType: 'page' | 'space' | 'tag', targetId: number) =>
    api.post<any, ApiResp<{ subscriptionId: number }>>('/wiki/subscriptions', { targetType, targetId }),
  unsubscribe: (id: number) => api.delete<any, ApiResp<null>>(`/wiki/subscriptions/${id}`),

  // 贡献者
  pageContributors: (pageId: number) => api.get<any, ApiResp<any[]>>(`/wiki/pages/${pageId}/contributors`),
  spaceContributors: (spaceId: number) => api.get<any, ApiResp<any[]>>(`/wiki/spaces/${spaceId}/contributors`),

  // 批量
  batchPages: (action: string, pageIds: number[], payload?: any) =>
    api.post<any, ApiResp<any[]>>('/wiki/pages/batch', { action, pageIds, payload }),

  // 回收站
  trash: (spaceId?: number) => api.get<any, ApiResp<any[]>>('/wiki/trash', { params: { spaceId } }),

  // 导出 URL（直接下载）
  exportPageUrl: (pageId: number, format: 'md' | 'pdf') =>
    `/api/wiki/pages/${pageId}/export?format=${format}`,
  exportSpaceUrl: (spaceId: number) =>
    `/api/wiki/spaces/${spaceId}/export`,

  // 通知（前端红点）
  notifyUnreadCount: () => api.get<any, ApiResp<{ count: number }>>('/wiki/notifications/unread-count'),
  notifications: (unread = false) =>
    api.get<any, ApiResp<any[]>>('/wiki/notifications', { params: { unread: unread ? '1' : undefined } }),
  markNotificationRead: (id: number) => api.post<any, ApiResp<null>>(`/wiki/notifications/${id}/read`),
  markAllNotificationsRead: () => api.post<any, ApiResp<null>>('/wiki/notifications/read-all'),

  // 异步导出任务（整库 PDF）
  exportSpacePdf: (spaceId: number) =>
    api.get<any, ApiResp<{ taskId: string }>>(`/wiki/spaces/${spaceId}/export`, { params: { format: 'pdf' } }),
  exportTaskStatus: (taskId: string) =>
    api.get<any, ApiResp<{
      id: string; status: 'pending'|'running'|'done'|'failed';
      progress?: { done: number; total: number; phase: string };
      error?: string; filename?: string; sizeBytes?: number;
      downloadUrl?: string; createdAt: number; finishedAt?: number;
    }>>(`/wiki/export-tasks/${taskId}`),
  exportTaskDownloadUrl: (taskId: string) => `/api/wiki/export-tasks/${taskId}/download`,

  // 页面级权限（F13 前端，复用 /api/permissions）
  listPagePermissions: (pageId: number) =>
    api.get<any, ApiResp<any[]>>(`/permissions/wiki_page/${pageId}`),
  setPagePermission: (data: { resourceId: number; userId?: number; groupId?: number; permissionTypes: string[] }) =>
    api.post<any, ApiResp<null>>('/permissions', { ...data, resourceType: 'wiki_page' }),
  revokePagePermission: (id: number) => api.delete<any, ApiResp<null>>(`/permissions/${id}`),

  // 编辑器粘贴/拖拽图片上传，返回的 url 可直接拼入 ![](url)
  uploadInlineImage: (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return api.post<any, ApiResp<{ url: string }>>('/wiki/upload-image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  }
}
