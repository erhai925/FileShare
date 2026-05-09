import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from './stores/authStore'
import api from './services/api'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Files from './pages/Files'
import Spaces from './pages/Spaces'
import SpaceDetail from './pages/SpaceDetail'
import FileDetail from './pages/FileDetail'
import Trash from './pages/Trash'
import Admin from './pages/Admin'
import Profile from './pages/Profile'
import WikiHome from './pages/wiki/WikiHome'
import WikiSpace from './pages/wiki/WikiSpace'
import WikiPage from './pages/wiki/WikiPage'
import WikiPageEdit from './pages/wiki/WikiPageEdit'
import WikiSearch from './pages/wiki/WikiSearch'
import WikiTrash from './pages/wiki/WikiTrash'
import WikiTags from './pages/wiki/WikiTags'
import WikiSubscriptions from './pages/wiki/WikiSubscriptions'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token, isAuthenticated, logout } = useAuthStore()
  const [hydrated, setHydrated] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  // 等待 zustand 从 localStorage 恢复完成（persist 可能先于监听器完成，用短延迟确保读到持久化状态）
  useEffect(() => {
    const t = setTimeout(() => setHydrated(true), 50)
    return () => clearTimeout(t)
  }, [])

  // 恢复完成后：无 token 则直接视为未登录；有 token 则请求 /auth/me 校验，失败则清除登录态
  useEffect(() => {
    if (!hydrated) return
    if (!token) {
      setAuthChecked(true)
      return
    }
    let cancelled = false
    api.get('/auth/me')
      .then(() => { if (!cancelled) setAuthChecked(true) })
      .catch(() => {
        if (!cancelled) {
          logout()
          setAuthChecked(true)
        }
      })
    return () => { cancelled = true }
  }, [hydrated, token, logout])

  if (!hydrated || (token && !authChecked)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Spin size="large" tip="验证登录状态..." />
      </div>
    )
  }
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="files" element={<Files />} />
        <Route path="files/:fileId" element={<FileDetail />} />
        <Route path="trash" element={<Trash />} />
        <Route path="spaces" element={<Spaces />} />
        <Route path="spaces/:spaceId" element={<SpaceDetail />} />
        <Route path="wiki" element={<WikiHome />} />
        <Route path="wiki/search" element={<WikiSearch />} />
        <Route path="wiki/trash" element={<WikiTrash />} />
        <Route path="wiki/tags" element={<WikiTags />} />
        <Route path="wiki/subscriptions" element={<WikiSubscriptions />} />
        <Route path="wiki/spaces/:spaceId" element={<WikiSpace />} />
        <Route path="wiki/spaces/:spaceId/p/:pageId" element={<WikiPage />} />
        <Route path="wiki/spaces/:spaceId/p/:pageId/edit" element={<WikiPageEdit />} />
        <Route path="wiki/spaces/:spaceId/new" element={<WikiPageEdit />} />
        <Route path="admin" element={<Admin />} />
        <Route path="profile" element={<Profile />} />
      </Route>
    </Routes>
  )
}

export default App

