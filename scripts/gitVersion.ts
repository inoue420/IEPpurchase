import { execFileSync } from 'node:child_process'

/** Read only at Vite startup/build time. Git is never accessed by the browser. */
export function readGitVersion(repositoryPath: string, development = false): string {
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: repositoryPath,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()

  try {
    const dirty = git('status', '--porcelain', '--untracked-files=normal') !== ''
    let description: string
    try {
      description = git('describe', '--tags', '--long', '--match', 'v[0-9]*', '--exclude', '*-*', 'HEAD')
    } catch {
      return `${git('rev-parse', '--short', 'HEAD')}${dirty ? '-dirty' : ''}（開発版）`
    }

    const match = /^(v\d+\.\d+\.\d+)-(\d+)-g([0-9a-f]+)$/.exec(description)
    if (!match) return `${git('rev-parse', '--short', 'HEAD')}${dirty ? '-dirty' : ''}（開発版）`

    const [, tag, distance, commit] = match
    if (distance === '0' && !dirty) return development ? `${tag}（開発版）` : tag
    const version = distance === '0' ? tag : `${tag}-${distance}-g${commit}`
    return `${version}${dirty ? '-dirty' : ''}（開発版）`
  } catch {
    // Source archives or environments without Git must remain buildable.
    return '開発版（バージョン不明）'
  }
}
