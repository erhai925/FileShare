const { contextBridge, ipcRenderer } = require('electron')

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 选择文件
  selectFile: () => ipcRenderer.invoke('select-file'),
  
  // 选择文件夹
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // 保存文件
  saveFile: (defaultPath, filters) => ipcRenderer.invoke('save-file', defaultPath, filters),
  
  // 获取平台信息
  platform: process.platform,
  
  // 获取版本信息
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
})



