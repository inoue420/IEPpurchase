import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readGitVersion } from './gitVersion'

let repositoryPath: string

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: repositoryPath, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

beforeEach(() => {
  repositoryPath = mkdtempSync(join(tmpdir(), 'ieppurchase-version-'))
  git('init')
  git('config', 'user.name', 'Version test')
  git('config', 'user.email', 'version-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(repositoryPath, 'app.txt'), 'initial\n')
  git('add', 'app.txt')
  git('commit', '-m', 'Initial')
})

afterEach(() => {
  // Recursive cleanup is confined to the temporary repository created above.
  if (dirname(resolve(repositoryPath)) !== resolve(tmpdir()) || !basename(repositoryPath).startsWith('ieppurchase-version-')) {
    throw new Error('Unexpected test repository path')
  }
  rmSync(repositoryPath, { recursive: true, force: true })
})

describe('Git release version', () => {
  it('uses a lightweight tag at the current clean commit', () => {
    git('tag', 'v1.0.1')
    expect(readGitVersion(repositoryPath)).toBe('v1.0.1')
  })

  it('also supports annotated release tags', () => {
    git('-c', 'tag.gpgsign=false', 'tag', '-a', 'v1.0.0', '-m', 'Release')
    expect(readGitVersion(repositoryPath)).toBe('v1.0.0')
  })

  it('does not report changes after a tagged release as that release', () => {
    git('tag', 'v1.0.0')
    writeFileSync(join(repositoryPath, 'app.txt'), 'updated\n')
    git('add', 'app.txt')
    git('commit', '-m', 'Update')
    expect(readGitVersion(repositoryPath)).toMatch(/^v1\.0\.0-1-g[0-9a-f]+（開発版）$/)
  })

  it('marks both edited files and new untracked files as development builds', () => {
    git('tag', 'v1.0.0')
    writeFileSync(join(repositoryPath, 'app.txt'), 'uncommitted\n')
    expect(readGitVersion(repositoryPath)).toBe('v1.0.0-dirty（開発版）')
    git('restore', 'app.txt')
    writeFileSync(join(repositoryPath, 'new.txt'), 'untracked\n')
    expect(readGitVersion(repositoryPath)).toBe('v1.0.0-dirty（開発版）')
  })

  it('keeps repositories without release tags buildable', () => {
    git('tag', 'unrelated-tag')
    expect(readGitVersion(repositoryPath)).toMatch(/^[0-9a-f]+（開発版）$/)
  })

  it('does not label pre-release tags as a stable release', () => {
    git('tag', 'v1.0.0')
    writeFileSync(join(repositoryPath, 'app.txt'), 'updated\n')
    git('add', 'app.txt')
    git('commit', '-m', 'Update')
    git('tag', 'v1.0.1-rc.1')
    expect(readGitVersion(repositoryPath)).toMatch(/^v1\.0\.0-1-g[0-9a-f]+（開発版）$/)
  })

  it('allows source archives without Git metadata to build', () => {
    expect(readGitVersion(tmpdir())).toBe('開発版（バージョン不明）')
  })
})
