import { shell } from 'electron'

export function revealInFinder(filePath: string): void {
  shell.showItemInFolder(filePath)
}
