import { App } from '@renderer/App'
import { initSpotlight } from '@renderer/components/fx/spotlight'
import { AppProviders } from '@renderer/providers/AppProviders'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/index.css'

initSpotlight()

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
