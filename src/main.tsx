import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import GCSDApp from './GCSDApp'
import { Toaster } from 'sonner'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Toaster position="top-right" richColors />
    <GCSDApp />
  </React.StrictMode>,
)
