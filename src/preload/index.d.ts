import { ElectronApi } from './index'

declare global {
  interface Window {
    api: ElectronApi
  }
}
