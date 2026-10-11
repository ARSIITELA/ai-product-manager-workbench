// @vitest-environment jsdom
import type {} from '../src/client/index.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { SiminShell } from '../src/client/SiminShell.tsx'
import { siminZh } from '../src/client/simin-locales.ts'
import { saveSiminView, SIMIN_OPEN_PROJECT_EVENT } from '../src/client/simin-state.ts'
import type { SiminSnapshot } from '../src/client/simin-api.ts'

const snapshot: SiminSnapshot = {
  root: '/projects', trash: [], proposals: [],
  projects: [{ name: '相机助手', path: '/projects/相机助手', documents: ['研究.md'], files: [{ name: '研究.md', modifiedAt: 1780272000000, bytes: 30, preview: '用户希望减少调参' }] }],
}
const copy = makeTranslate(siminZh, commonZh)
let requests: { path: string; payload?: Record<string, unknown> }[]
let failCreate: boolean
beforeEach(() => {
  localStorage.clear()
  requests = []; failCreate = false
  vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('06/01')
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    const payload = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
    requests.push({ path, ...(payload === undefined ? {} : { payload }) })
    if (path === '/aipm/projects') return { ok: !failCreate, json: async () => failCreate ? { error: 'duplicate' } : { name: payload?.name, path: `/projects/${String(payload?.name)}` } }
    if (path.startsWith('/aipm/file')) return { ok: true, json: async () => ({ markdown: '# 研究\n\n用户希望减少调参。', version: 'v1' }) }
    return { ok: true, json: async () => snapshot }
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function mount() {
  const result = render(<SiminShell chat={<div>conversation</div>} nativeSettings={<div>settings host</div>} t={copy} />)
  await screen.findByText(siminZh.heroTitle)
  return result
}
async function openTask(title: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}`) }))
  return screen.findByRole('dialog')
}

describe('AI product workbench', () => {
  it('shows six tasks, real projects and recent deliverables in one navigation', async () => {
    const result = await mount()
    expect(screen.getByRole('navigation', { name: siminZh.navLabel })).toBeTruthy()
    for (const kind of ['initiation', 'prd', 'research', 'evaluation', 'prompt', 'roadmap'] as const) expect(screen.getByRole('button', { name: new RegExp(`^${siminZh[`${kind}Title`]}`) })).toBeTruthy()
    expect(screen.getByText(/1 个项目/u)).toBeTruthy()
    expect(screen.getByText(/1 份成果/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: /研究.*相机助手/u })).toBeTruthy()
    const main = result.container.querySelector('main')
    expect(main).not.toBeNull()
    await expect(main?.innerHTML.replace(/上午好，小沼|下午好，小沼/u, '你好，小沼')).toMatchFileSnapshot('./expected/workbench-home.html')
  })
  it('prepares a PRD draft with supplied material in the chosen project without sending it', async () => {
    await mount()
    const dialog = await openTask(siminZh.prdTitle)
    expect(within(dialog).getByText(siminZh.prdSections)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(siminZh.taskBrief), { target: { value: '为新手设计一键自然人像，保留失败回退。' } })
    const events: unknown[] = []
    const listener = (event: Event): void => { events.push((event as CustomEvent).detail) }
    window.addEventListener(SIMIN_OPEN_PROJECT_EVENT, listener)
    try {
      fireEvent.click(within(dialog).getByRole('button', { name: siminZh.taskStart }))
      await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
      expect(events).toContainEqual({ path: '/projects/相机助手', draft: `${siminZh.taskCommonPrompt}\n\n${siminZh.prdPrompt}\n\n${siminZh.taskBrief}:\n为新手设计一键自然人像，保留失败回退。` })
      expect(requests.some(request => request.payload !== undefined)).toBe(false)
      expect(JSON.parse(localStorage.getItem('aipm.simin.v1') ?? '{}')).toMatchObject({ project: '相机助手', page: 'project', tab: 'chat' })
    } finally { window.removeEventListener(SIMIN_OPEN_PROJECT_EVENT, listener) }
  })
  it('requires material before creating a new project for a task', async () => {
    await mount()
    const dialog = await openTask(siminZh.initiationTitle)
    fireEvent.change(within(dialog).getByLabelText(siminZh.taskProject), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText(siminZh.projectName), { target: { value: '知识助手' } })
    fireEvent.click(within(dialog).getByRole('button', { name: siminZh.taskStart }))
    await screen.findByRole('alert')
    expect(within(dialog).getByText(siminZh.taskBriefRequired)).toBeTruthy()
    expect(requests.some(request => request.path === '/aipm/projects')).toBe(false)
    fireEvent.change(within(dialog).getByLabelText(siminZh.taskBrief), { target: { value: '帮助团队检索内部知识，范围只含只读问答。' } })
    fireEvent.click(within(dialog).getByRole('button', { name: siminZh.taskStart }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(requests).toContainEqual({ path: '/aipm/projects', payload: { name: '知识助手' } })
    expect(JSON.parse(localStorage.getItem('aipm.simin.v1') ?? '{}')).toMatchObject({ project: '知识助手', tab: 'chat' })
  })
  it('retains task material when project creation fails', async () => {
    await mount()
    const dialog = await openTask(siminZh.evaluationTitle)
    fireEvent.change(within(dialog).getByLabelText(siminZh.taskProject), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText(siminZh.projectName), { target: { value: '知识助手' } })
    fireEvent.change(within(dialog).getByLabelText(siminZh.taskBrief), { target: { value: '测量问答的引用准确率' } })
    failCreate = true
    fireEvent.click(within(dialog).getByRole('button', { name: siminZh.taskStart }))
    await screen.findByRole('alert')
    expect(within(dialog).getByText(siminZh.duplicate)).toBeTruthy()
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>(siminZh.taskBrief).value).toBe('测量问答的引用准确率')
    expect(localStorage.getItem('aipm.simin.v1')).toBeNull()
  })
  it('downloads the selected document without changing its contents', async () => {
    saveSiminView({ project: '相机助手', file: '研究.md', page: 'project', tab: 'document' })
    const createObjectURL = vi.fn(() => 'blob:workbench-document')
    vi.stubGlobal('URL', class extends URL { static override createObjectURL = createObjectURL; static override revokeObjectURL = vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<SiminShell chat={<div>conversation</div>} nativeSettings={<div>settings host</div>} t={copy} />)
    await screen.findByText('用户希望减少调参。')
    fireEvent.click(screen.getByRole('button', { name: siminZh.download }))
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    const anchor = click.mock.contexts[0] as HTMLAnchorElement | undefined
    expect(anchor?.download).toBe('研究.md')
    expect(anchor?.href).toBe('blob:workbench-document')
    expect(requests.some(request => request.payload !== undefined)).toBe(false)
  })
})
