import { App } from '@renderer/App'
import { AppProviders } from '@renderer/providers/AppProviders'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
