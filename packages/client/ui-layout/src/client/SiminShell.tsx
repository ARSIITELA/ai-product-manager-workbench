/** Complete personal workbench over real local projects and the existing conversation slot. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MarkdownText, DiffBlock, Modal, Toast, Tooltip, Switch, IconPlusOutlineRegular, IconSearchOutlineRegular,
  IconFolderCloseRegular, IconDeliverDocRegular, IconTrashOutlineRegular,
  IconPanelLeftOutlineRegular, IconCopyOutlineRegular,
  IconFullscreenOutlineRegular, IconCodeOutlineRegular, IconEditOutlineRegular, IconChevronRightOutlineRegular,
  IconBrowseOutlineRegular, AipmMark,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  loadSiminView, saveSiminView, loadSiminPreferences, saveSiminPreferences,
  SIMIN_CHANGE_EVENT, SIMIN_OPEN_PROJECT_EVENT, SIMIN_WORKSPACE_ERROR_EVENT,
} from './simin-state.ts'
import type { SiminPage, SiminView } from './simin-state.ts'
import { siminRequest, siminSnapshot, siminDocument } from './simin-api.ts'
import type { SiminSnapshot, SiminProject, SiminDocument, SiminProposal, SiminTrash, SiminConversationHit } from './simin-api.ts'
import { siminZh } from './simin-locales.ts'
import type { SiminKey } from './simin-locales.ts'
import { SiminIcon } from './SiminIcons.tsx'
import css from './SiminShell.module.css'

type Copy = PropsLocale<'simin'>['t']
const taskKinds = ['initiation', 'prd', 'research', 'evaluation', 'prompt', 'roadmap'] as const
type TaskKind = typeof taskKinds[number]
type FileRow = { project: SiminProject; name: string; preview: string; modifiedAt: number }
interface Dialog {
  kind: 'create' | 'rename' | 'trash' | 'purge' | 'preview' | 'template' | 'newDoc'
  project?: string
  file?: string
  version?: string | null
  markdown?: string
  proposal?: SiminProposal
  deleted?: SiminTrash
  template?: TaskKind
}
const initialSnapshot: SiminSnapshot = { root: '', projects: [], trash: [], proposals: [] }
function plain(name: string): string { return name.replace(/\.(md|txt)$/iu, '') }
function date(value: number): string { return new Date(value).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' }) }
function Star() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5l2.1 7.4 7.4 2.1-7.4 2.1-2.1 7.4-2.1-7.4-7.4-2.1 7.4-2.1z" /></svg> }
function Folder({ project, onOpen, t }: { project: SiminProject; onOpen: () => void; t: Copy }) {
  const latest = [...project.files].sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
  return <button type="button" className={css.folderCard} onClick={onOpen}>
    <span className={css.projectCardTop}><span className={css.projectIcon}><IconFolderCloseRegular size={21} /></span><span className={css.projectDocCount}>{t('fileCount', { count: project.documents.length })}</span><IconChevronRightOutlineRegular size={15} /></span>
    <strong className={css.projectName}>{project.name}</strong>
    <span className={css.projectPreview}>{latest?.preview || t('projectUntouched')}</span>
    <span className={css.projectCardFoot}><IconDeliverDocRegular size={12} /><span>{latest === undefined ? t('noDocuments') : plain(latest.name)}</span>{latest !== undefined && <time>{date(latest.modifiedAt)}</time>}</span>
  </button>
}
function Reading({ text, t }: { text: string; t: Copy }) {
  return <MarkdownText text={text} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('read') }} />
}

/**
 * Render the personal workbench over the existing conversation.
 * @param props - existing conversation, settings host, and workbench dictionary.
 * @returns the desktop workbench.
 */
export function SiminShell({ chat, nativeSettings, t }: { chat: ReactNode; nativeSettings: ReactNode; t: Copy }) {
  const [view, setView] = useState<SiminView>(() => loadSiminPreferences().remember ? loadSiminView() : { project: null, file: null, page: 'home' })
  const [prefs, setPrefs] = useState(loadSiminPreferences)
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [document, setDocument] = useState<SiminDocument | null>(null)
  const [fileError, setFileError] = useState(false)
  const [workspace, setWorkspace] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [ideaDraft, setIdeaDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [targetProject, setTargetProject] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)
  const [source, setSource] = useState(false)
  const [focus, setFocus] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [listView, setListView] = useState(false)
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [hits, setHits] = useState<SiminConversationHit[]>([])
  const [searchError, setSearchError] = useState(false)
  const [searchIndex, setSearchIndex] = useState(0)
  const [fullMatches, setFullMatches] = useState<Set<string> | null>(null)
  const opening = useRef<string | null>(null)
  const poll = useRef<AbortController | null>(null)
  const previous = useRef<SiminSnapshot | null>(null)
  const page = view.page ?? (view.project === null ? 'home' : 'project')
  const project = snapshot.projects.find(item => item.name === view.project)
  const currentPath = useRef(project?.path)
  currentPath.current = project?.path
  const notify = (key: SiminKey): void => { setToast({ text: t(key), seq: Date.now() }) }
  const errorCopy = (error: unknown): string => {
    const code = error instanceof Error ? error.message : ''
    return t(code in siminZh ? code as SiminKey : 'io')
  }
  const refresh = useCallback(async (): Promise<void> => {
    if (poll.current !== null) return
    const controller = new AbortController()
    poll.current = controller
    try {
      const next = await siminSnapshot(controller.signal)
      if (!controller.signal.aborted) { setSnapshot(next); setLoadError(false); setLoading(false) }
    } catch (error: unknown) {
      if (!controller.signal.aborted) { void error; setLoadError(true); setLoading(false) }
    } finally { if (poll.current === controller) poll.current = null }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2000)
    return () => { window.clearInterval(timer); poll.current?.abort() }
  }, [refresh])
  useEffect(() => {
    const changed = (): void => { setView(loadSiminView()); setNavOpen(false); setFocus(false); setSource(false) }
    const error = (event: Event): void => {
      const detail: unknown = (event as CustomEvent).detail
      if (detail === undefined || detail === currentPath.current) setWorkspace('error')
    }
    const ready = (event: Event): void => {
      const detail: unknown = (event as CustomEvent).detail
      if (typeof detail === 'object' && detail !== null && 'path' in detail && detail.path === currentPath.current) setWorkspace('ready')
    }
    const key = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopImmediatePropagation(); setSearchOpen(true) }
      if (event.key === 'Escape') { setFocus(false); setNavOpen(false) }
    }
    window.addEventListener(SIMIN_CHANGE_EVENT, changed)
    window.addEventListener(SIMIN_WORKSPACE_ERROR_EVENT, error)
    window.addEventListener('aipm-workspace-ready', ready)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener(SIMIN_CHANGE_EVENT, changed); window.removeEventListener(SIMIN_WORKSPACE_ERROR_EVENT, error); window.removeEventListener('aipm-workspace-ready', ready); window.removeEventListener('keydown', key, true) }
  }, [])
  useEffect(() => {
    if (project === undefined || opening.current === project.path) return
    opening.current = project.path
    setWorkspace('loading')
    window.dispatchEvent(new CustomEvent(SIMIN_OPEN_PROJECT_EVENT, { detail: project.path }))
  }, [project])
  useEffect(() => {
    const controller = new AbortController()
    setDocument(null); setFileError(false)
    if (view.project === null || view.file === null) return () => { controller.abort() }
    let running = false
    const pull = async (): Promise<void> => {
      if (running) return
      running = true
      try {
        const next = await siminDocument(view.project ?? '', view.file ?? '', controller.signal)
        if (!controller.signal.aborted) { setDocument(next); setFileError(false) }
      } catch (error: unknown) { if (!controller.signal.aborted) { void error; setFileError(true) } }
      finally { running = false }
    }
    void pull()
    const timer = window.setInterval(() => { void pull() }, 2000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [view.project, view.file])
  useEffect(() => {
    const old = previous.current
    previous.current = snapshot
    if (old !== null && snapshot.proposals.some(item => item.status === 'saved' && old.proposals.some(prior => prior.id === item.id && prior.status !== 'saved'))) notify('saved')
    if (old === null || project === undefined || !prefs.autoOpen || view.file !== null || page !== 'project') return
    const before = old.projects.find(item => item.name === project.name)
    if (before !== undefined && before.documents.length === 0 && project.documents.length > 0) saveSiminView({ ...view, file: project.documents[0] ?? null, tab: 'document' })
  }, [snapshot, project, prefs.autoOpen, view, page])
  useEffect(() => {
    const controller = new AbortController()
    const phrase = (searchOpen ? searchQuery : query).trim()
    setFullMatches(null)
    if (!phrase) { setHits([]); return () => { controller.abort() } }
    const id = `${Date.now()}-${Math.random()}`
    const result = (event: Event): void => {
      const detail = (event as CustomEvent<{ id: string; items?: SiminConversationHit[]; error?: boolean }>).detail
      if (detail.id !== id) return
      setHits(detail.items ?? []); setSearchError(detail.error === true)
    }
    window.addEventListener('aipm-search-results', result)
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('aipm-search-conversations', { detail: { id, query: phrase } }))
      void siminRequest(`/aipm/search?query=${encodeURIComponent(phrase)}`, undefined, controller.signal).then((data) => {
        if (typeof data === 'object' && data !== null && 'items' in data && Array.isArray(data.items)) {
          const keys = data.items.flatMap((item: unknown) => typeof item === 'object' && item !== null && 'project' in item && 'file' in item && typeof item.project === 'string' && typeof item.file === 'string' ? [`${item.project}/${item.file}`] : [])
          if (!controller.signal.aborted) setFullMatches(new Set(keys))
        }
      }).catch((error: unknown) => { if (!controller.signal.aborted) { void error; setSearchError(true) } })
    }, 220)
    return () => { window.clearTimeout(timer); window.removeEventListener('aipm-search-results', result); controller.abort() }
  }, [searchQuery, searchOpen, query])
  const navigate = (next: SiminPage): void => { saveSiminView({ ...view, page: next }); setQuery(''); setProjectFilter('') }
  const openProject = (item: SiminProject, file: string | null = null, tab: 'overview' | 'chat' | 'document' = file === null ? (item.documents.length ? 'overview' : 'chat') : 'document'): void => {
    saveSiminView({ project: item.name, file, page: 'project', tab })
  }
  const draftToProject = (item: SiminProject, prompt: string): void => {
    openProject(item, null, 'chat')
    opening.current = item.path
    setWorkspace('loading')
    window.dispatchEvent(new CustomEvent(SIMIN_OPEN_PROJECT_EVENT, { detail: { path: item.path, draft: prompt } }))
  }
  const begin = (next: Dialog): void => {
    setDialog(next); setNameDraft(next.file ?? ''); setBodyDraft(next.markdown ?? '')
    setIdeaDraft(''); setPreviewing(false); setBusy(false); setFormError('')
    setTargetProject(project?.name ?? snapshot.projects[0]?.name ?? '')
  }
  const startTask = (kind: TaskKind): void => { begin({ kind: 'template', template: kind }) }
  const download = (): void => {
    if (document === null || view.file === null) return
    const url = URL.createObjectURL(new Blob([document.markdown], { type: 'text/markdown;charset=utf-8' }))
    const anchor = window.document.createElement('a')
    anchor.href = url; anchor.download = view.file
    window.document.body.appendChild(anchor); anchor.click(); anchor.remove()
    window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
  }
  const fileAction = async (row: FileRow, kind: 'rename' | 'trash'): Promise<void> => {
    try {
      const current = await siminDocument(row.project.name, row.name)
      begin({ kind, project: row.project.name, file: row.name, version: current.version })
    }
    catch (error: unknown) { setToast({ text: errorCopy(error), seq: Date.now() }) }
  }
  const copy = async (text: string): Promise<void> => {
    try { await navigator.clipboard.writeText(text); notify('copied') }
    catch (error: unknown) { setToast({ text: errorCopy(error), seq: Date.now() }) }
  }
  const closeDialog = (): void => { if (!busy) setDialog(null) }
  const commit = async (): Promise<void> => {
    if (dialog === null || busy) return
    setBusy(true); setFormError('')
    try {
      if (dialog.kind === 'create') {
        const data = await siminRequest('/aipm/projects', { name: nameDraft })
        if (typeof data !== 'object' || data === null || !('name' in data) || !('path' in data) || typeof data.name !== 'string' || typeof data.path !== 'string') throw new Error('invalidData')
        const created: SiminProject = { name: data.name, path: data.path, documents: [], files: [] }
        setSnapshot(previousSnapshot => ({ ...previousSnapshot, projects: [...previousSnapshot.projects, created] }))
        if (ideaDraft.trim()) draftToProject(created, ideaDraft.trim()); else openProject(created)
      } else if (dialog.kind === 'preview' && dialog.proposal !== undefined) {
        await siminRequest('/aipm/decide', { id: dialog.proposal.id, allow: true })
      } else if (dialog.kind === 'newDoc') {
        if (!previewing) { if (!nameDraft.trim() || !bodyDraft.trim()) throw new Error('invalidName'); if (!/\.(md|txt)$/iu.test(nameDraft)) setNameDraft(`${nameDraft.trim()}.md`); setPreviewing(true); return }
        await siminRequest('/aipm/mutate', { op: 'save', project: dialog.project, file: nameDraft, markdown: bodyDraft, version: null })
        notify('saved')
        if (project !== undefined) openProject(project, nameDraft, 'document')
      } else if (dialog.kind === 'rename') {
        await siminRequest('/aipm/mutate', { op: 'rename', project: dialog.project, file: dialog.file, name: nameDraft, version: dialog.version })
        notify('renamed')
        if (view.project === dialog.project && view.file === dialog.file) saveSiminView({ ...view, file: nameDraft })
      } else if (dialog.kind === 'trash') {
        await siminRequest('/aipm/mutate', { op: 'trash', project: dialog.project, file: dialog.file, version: dialog.version })
        notify('removed')
        if (view.project === dialog.project && view.file === dialog.file) saveSiminView({ ...view, file: null, tab: 'overview' })
      } else if (dialog.kind === 'purge' && dialog.deleted !== undefined) {
        await siminRequest('/aipm/mutate', { op: 'purge', id: dialog.deleted.id, version: dialog.deleted.version }); notify('purged')
      } else if (dialog.kind === 'template') {
        const kind = dialog.template ?? 'initiation'
        if (targetProject === '' && !bodyDraft.trim()) throw new Error('taskBriefRequired')
        let target = snapshot.projects.find(item => item.name === targetProject)
        if (targetProject === '') {
          if (!nameDraft.trim()) throw new Error('invalidName')
          const data = await siminRequest('/aipm/projects', { name: nameDraft })
          if (typeof data !== 'object' || data === null || !('name' in data) || !('path' in data) || typeof data.name !== 'string' || typeof data.path !== 'string') throw new Error('invalidData')
          target = { name: data.name, path: data.path, documents: [], files: [] }
          const created = target
          setSnapshot(previousSnapshot => ({ ...previousSnapshot, projects: [...previousSnapshot.projects, created] }))
        }
        if (target === undefined) throw new Error('missing')
        const brief = bodyDraft.trim() ? `${t('taskBrief')}:\n${bodyDraft.trim()}` : ''
        draftToProject(target, [t('taskCommonPrompt'), t(`${kind}Prompt`), brief].filter(Boolean).join('\n\n'))
      }
      setDialog(null); await refresh()
    } catch (error: unknown) { setFormError(errorCopy(error)) }
    finally { setBusy(false) }
  }
  const reject = async (): Promise<void> => {
    if (dialog?.proposal === undefined || busy) return
    setBusy(true)
    try { await siminRequest('/aipm/decide', { id: dialog.proposal.id, allow: false }); setDialog(null); notify('rejected'); await refresh() }
    catch (error: unknown) { setFormError(errorCopy(error)) }
    finally { setBusy(false) }
  }
  const restore = async (item: SiminTrash): Promise<void> => {
    try { await siminRequest('/aipm/mutate', { op: 'restore', id: item.id, version: item.version }); notify('restored'); await refresh() }
    catch (error: unknown) { setToast({ text: errorCopy(error), seq: Date.now() }) }
  }
  const allFiles: FileRow[] = snapshot.projects.flatMap(item => item.files.map(file => ({ project: item, ...file })))
  const recentFiles = [...allFiles].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 4)
  const filtered = allFiles.filter(row => (!projectFilter || row.project.name === projectFilter) && (!query.trim() || (fullMatches !== null ? fullMatches.has(`${row.project.name}/${row.name}`) : `${row.name} ${row.preview}`.toLowerCase().includes(query.toLowerCase()))))
  const proposalRows = snapshot.proposals.filter(item => item.project === project?.name && ['pending', 'interrupted', 'failed'].includes(item.status))
  const button = (label: SiminKey, action: () => void, primary = false, icon?: ReactNode): ReactNode => <button type="button" className={primary ? css.primary : css.button} onClick={action}>{icon}{t(label)}</button>
  const iconButton = (label: SiminKey, action: () => void, icon: ReactNode): ReactNode => <Tooltip label={t(label)} portal side="bottom"><button type="button" className={css.iconButton} aria-label={t(label)} onClick={action}>{icon}</button></Tooltip>
  const fileTable = (rows: FileRow[]): ReactNode => rows.length === 0 ? <div className={css.emptyState}><IconDeliverDocRegular size={26} /><h2>{t(query ? 'noResults' : 'noDocuments')}</h2></div> : <div className={css.tableWrap}><table className={css.table}><thead><tr><th>{t('filename')}</th><th>{t('projects')}</th><th>{t('date')}</th><th>{t('actions')}</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.project.name}/${row.name}`}><td><button className={css.fileName} onClick={() => { openProject(row.project, row.name) }}><IconDeliverDocRegular size={16} />{plain(row.name)}</button></td><td>{row.project.name}</td><td>{date(row.modifiedAt)}</td><td><div className={css.rowActions}>{iconButton('rename', () => { void fileAction(row, 'rename') }, <IconEditOutlineRegular size={14} />)}{iconButton('remove', () => { void fileAction(row, 'trash') }, <IconTrashOutlineRegular size={14} />)}</div></td></tr>)}</tbody></table></div>
  const taskCard = (kind: TaskKind): ReactNode => <button type="button" key={kind} className={css.taskCard} data-task={kind} onClick={() => { startTask(kind) }}>
    <span className={css.taskCardHeading}><span className={css.taskIcon} data-task={kind}>{kind === 'research' ? <IconSearchOutlineRegular size={20} /> : kind === 'evaluation' ? <SiminIcon name="facts" size={20} /> : kind === 'prompt' ? <IconCodeOutlineRegular size={20} /> : kind === 'roadmap' ? <SiminIcon name="next" size={20} /> : kind === 'initiation' ? <SiminIcon name="idea" size={20} /> : <IconDeliverDocRegular size={20} />}</span><IconChevronRightOutlineRegular size={14} /></span>
    <h2>{t(`${kind}Title`)}</h2><p>{t(`${kind}Description`)}</p>
  </button>
  const templateButtons = taskKinds.map(taskCard)
  const settingsPage = <div className={`${css.page} ${css.settingsPage}`}>
    <h1>{t('settings')}</h1>
    <section className={css.settingsSection}>
      <h2>{t('preferences')}</h2>
      <div className={css.settingsRows}>
        <label className={css.preference}>
          <span>{t('sendMode')}</span>
          <select value={prefs.sendMode} onChange={(event) => {
            const next = { ...prefs, sendMode: event.target.value === 'modEnter' ? 'modEnter' as const : 'enter' as const }
            setPrefs(next); saveSiminPreferences(next)
          }}><option value="enter">{t('sendEnter')}</option><option value="modEnter">{t('sendMod')}</option></select>
        </label>
        {(['remember', 'autoOpen', 'reduced'] as const).map(key => <div key={key} className={css.preference}>
          <span>{t(key)}</span>
          <Switch className={css.preferenceSwitch} label={t(key)} checked={prefs[key]} onChange={(checked) => {
            const next = { ...prefs, [key]: checked }
            setPrefs(next); saveSiminPreferences(next)
          }} />
        </div>)}
      </div>
    </section>
    <section className={css.settingsSection}>
      <h2>{t('workspace')}</h2>
      <div className={css.settingsRow}>
        <div className={css.settingsCopy}><p>{t('localHint')}</p><code className={css.path}>{snapshot.root}</code></div>
        {button('pathCopy', () => { void copy(snapshot.root) }, false, <IconCopyOutlineRegular size={13} />)}
      </div>
    </section>
    <section className={css.settingsSection}>
      <h2>{t('modelSettings')}</h2>
      <div className={css.settingsRow}>
        <div className={css.settingsCopy}><p>{t('modelHint')}</p></div>
        <button type="button" className={css.button} onClick={() => { window.dispatchEvent(new CustomEvent('aipm-open-settings', { detail: 'models' })) }}>{t('openSettings')}<IconChevronRightOutlineRegular size={13} /></button>
      </div>
    </section>
  </div>
  const retryWorkspace = (): void => {
    if (project === undefined) return
    setWorkspace('loading'); window.dispatchEvent(new CustomEvent(SIMIN_OPEN_PROJECT_EVENT, { detail: project.path }))
  }
  const searchPhrase = searchQuery.trim().toLowerCase()
  const matchingProjects = snapshot.projects.filter(item => searchPhrase && item.name.toLowerCase().includes(searchPhrase))
  const matchingFiles = allFiles.filter(row => searchPhrase && (fullMatches !== null ? fullMatches.has(`${row.project.name}/${row.name}`) : `${row.name} ${row.preview}`.toLowerCase().includes(searchPhrase)))
  const results = [
    ...matchingProjects.map(item => ({ key: `p:${item.path}`, label: item.name, kind: t('projects'), snippet: t('fileCount', { count: item.documents.length }), open: () => { openProject(item) } })),
    ...matchingFiles.map(row => ({ key: `f:${row.project.name}/${row.name}`, label: plain(row.name), kind: row.project.name, snippet: row.preview, open: () => { openProject(row.project, row.name) } })),
    ...hits.filter(hit => snapshot.projects.some(item => item.path === hit.path)).map(hit => ({ key: `s:${hit.sessionId}`, label: hit.title, kind: `${hit.project} · ${t('conversations')}`, snippet: hit.snippet, open: () => {
      const target = snapshot.projects.find(item => item.path === hit.path)
      if (target === undefined) return
      openProject(target, null, 'chat'); opening.current = target.path; setWorkspace('loading')
      window.dispatchEvent(new CustomEvent(SIMIN_OPEN_PROJECT_EVENT, { detail: { path: target.path, sessionId: hit.sessionId } }))
    } })),
  ]
  const dialogKey: SiminKey = dialog?.kind === 'create' ? 'create' : dialog?.kind === 'rename' ? 'rename' : dialog?.kind === 'trash' ? 'remove' : dialog?.kind === 'purge' ? 'permanent' : dialog?.kind === 'template' ? `${dialog.template ?? 'initiation'}Title` : dialog?.proposal?.before ? 'diff' : dialog?.kind === 'newDoc' && !previewing ? 'newDoc' : 'preview'

  return <div className={`${css.shell} ${focus ? css.focused : ''}`} data-simin-page={page} data-reduced={prefs.reduced || undefined}>
    <aside className={`${css.side} ${navOpen ? css.sideOpen : ''}`}>
      <div className={css.brand} data-window-drag="true"><span className={css.orb}><AipmMark size={36} /></span><div>{t('brand')}<small>{t('personal')}</small></div></div>
      <button type="button" className={css.sideSearch} onClick={() => { setSearchOpen(true); setSearchIndex(0) }}><IconSearchOutlineRegular size={15} /><span>{t('search')}</span><kbd>{t('searchShortcut')}</kbd></button>
      <nav className={css.sideNav} aria-label={t('navLabel')}>{([['home', 'workbench'], ['templates', 'templates'], ['documents', 'documents']] as const).map(([entry, icon]) => <button key={entry} type="button" aria-current={page === entry ? 'page' : undefined} className={`${css.navItem} ${page === entry ? css.active : ''}`} onClick={() => { navigate(entry) }}><SiminIcon name={icon} size={17} /><span>{t(entry)}</span>{entry === 'documents' && <small>{allFiles.length}</small>}</button>)}</nav>
      <div className={css.divider} />
      <div className={css.groupLabel}>{page === 'project' ? project?.name : t('projects')}{iconButton('create', () => { begin({ kind: 'create' }) }, <IconPlusOutlineRegular size={14} />)}</div>
      <div className={css.sideScroll}>{page === 'project' && project !== undefined ? <>
        <button className={`${css.navItem} ${view.tab === 'overview' ? css.active : ''}`} onClick={() => { saveSiminView({ ...view, tab: 'overview' }) }}><IconBrowseOutlineRegular size={15} /><span>{t('overview')}</span></button>
        <button className={`${css.navItem} ${view.tab === 'chat' ? css.active : ''}`} onClick={() => { saveSiminView({ ...view, tab: 'chat' }) }}><Star /><span>{t('chat')}</span></button>
        <div className={css.groupLabel}>{t('read')}<span>{project.documents.length}</span></div>
        {project.documents.map(file => <button key={file} className={`${css.navItem} ${view.tab === 'document' && file === view.file ? css.active : ''}`} onClick={() => { saveSiminView({ ...view, file, tab: 'document' }) }}><IconDeliverDocRegular size={14} /><span>{plain(file)}</span></button>)}
        {button('newDoc', () => { begin({ kind: 'newDoc', project: project.name }) }, false, <IconPlusOutlineRegular size={14} />)}
      </> : <>{snapshot.projects.map((item, index) => <button key={item.path} className={css.navItem} onClick={() => { openProject(item) }}><span className={css.marker} data-tone={index % 3}><IconFolderCloseRegular size={13} /></span><span>{item.name}</span></button>)}{snapshot.projects.length === 0 && <p className={css.sideEmpty}>{t('noProjectsHint')}</p>}{button('create', () => { begin({ kind: 'create' }) }, false, <IconPlusOutlineRegular size={14} />)}</>}</div>
      <div className={css.sideBottom}>{(['trash', 'settings'] as const).map(entry => <button key={entry} className={`${css.navItem} ${page === entry ? css.active : ''}`} onClick={() => { navigate(entry) }}><SiminIcon name={entry} size={16} /><span>{t(entry)}</span></button>)}</div>
      <div className={css.sideFoot}><span className={css.localDot} /><div>{t('localWorkspace')}<small>{t('taskScopeHint')}</small></div></div>
    </aside>
    {navOpen && <button className={css.navMask} aria-label={t('close')} onClick={() => { setNavOpen(false) }} />}
    <main className={css.main}>
      <header className={css.header} data-window-drag="true">{iconButton('navToggle', () => { setNavOpen(!navOpen) }, <IconPanelLeftOutlineRegular size={17} />)}<span className={css.breadcrumb}>{t('workspaceTitle')}<IconChevronRightOutlineRegular size={12} /><span>{page === 'project' ? view.project : t(page)}</span></span><span className={css.headerSpacer} />{focus ? button('exitFocus', () => { setFocus(false) }) : button('newTask', () => { startTask('initiation') }, true, <IconPlusOutlineRegular size={14} />)}{iconButton('search', () => { setSearchOpen(true); setSearchIndex(0) }, <IconSearchOutlineRegular size={18} />)}</header>
      {loadError && <div className={css.notice} role="status">{t('loadingError')}{button('retry', () => { void refresh() })}</div>}
      <div className={css.content}>
        {loading ? <div className={css.loading}><span className={css.spinner} /></div> : page === 'home' ? <div className={css.home}>
          <div className={css.homeGreeting}><span>{t(new Date().getHours() < 12 ? 'morning' : 'afternoon')}</span><span className={css.workspaceSummary}>{t('projectCount', { count: snapshot.projects.length })}<span>·</span>{t('documentCount', { count: allFiles.length })}</span></div>
          <section className={css.hero}><div className={css.heroCopy}><span className={css.eyebrow}>{t('heroEyebrow')}</span><h1>{t('heroTitle')}</h1><p>{t('heroDescription')}</p>{button('heroAction', () => { startTask('initiation') }, true, <SiminIcon name="idea" size={15} />)}</div><div className={css.heroArt} aria-hidden="true"><span className={css.ripple} /><span className={css.ripple} /><span className={css.ripple} /><AipmMark size={136} /></div></section>
          <section className={css.homeTasks}><div className={css.sectionHeading}><div><h2>{t('taskHeading')}</h2><p>{t('taskHint')}</p></div><button className={css.textButton} onClick={() => { navigate('templates') }}>{t('viewTasks')}<IconChevronRightOutlineRegular size={13} /></button></div><div className={css.taskGrid}>{templateButtons}</div></section>
          <div className={css.homeBottom}><section className={css.homeProjects}><div className={css.sectionHeading}><div><h2>{t('projects')}</h2><p>{t('projectHint')}</p></div><span className={css.viewControls}>{iconButton('grid', () => { setListView(false) }, <IconBrowseOutlineRegular size={15} />)}{iconButton('list', () => { setListView(true) }, <IconPanelLeftOutlineRegular size={15} />)}{iconButton('create', () => { begin({ kind: 'create' }) }, <IconPlusOutlineRegular size={16} />)}</span></div>{snapshot.projects.length === 0 ? <div className={css.firstProject}><span className={css.projectIcon}><IconFolderCloseRegular size={24} /></span><h3>{t('projectEmpty')}</h3><p>{t('projectEmptyHint')}</p>{button('create', () => { begin({ kind: 'create' }) }, false, <IconPlusOutlineRegular size={14} />)}</div> : <div className={listView ? css.projectList : css.projectGrid}>{snapshot.projects.map(item => <Folder key={item.path} project={item} t={t} onOpen={() => { openProject(item) }} />)}</div>}</section>
            <section className={css.recentPanel}><div className={css.sectionHeading}><h2>{t('recent')}</h2><button className={css.textButton} onClick={() => { navigate('documents') }}>{t('viewDocuments')}<IconChevronRightOutlineRegular size={13} /></button></div>{recentFiles.length === 0 ? <div className={css.recentEmpty}><IconDeliverDocRegular size={25} /><h3>{t('recentEmpty')}</h3><p>{t('recentEmptyHint')}</p></div> : <div className={css.recentFiles}>{recentFiles.map(row => <button key={`${row.project.name}/${row.name}`} className={css.recentFile} onClick={() => { openProject(row.project, row.name) }}><span className={css.recentIcon}><IconDeliverDocRegular size={16} /></span><span><strong>{plain(row.name)}</strong><small>{row.project.name} · {date(row.modifiedAt)}</small></span><IconChevronRightOutlineRegular size={12} /></button>)}</div>}</section></div>
        </div> : page === 'documents' ? <div className={css.page}><h1>{t('documents')}</h1><div className={css.filters}><select aria-label={t('projects')} value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value) }}><option value="">{t('allProjects')}</option>{snapshot.projects.map(item => <option key={item.path}>{item.name}</option>)}</select><input aria-label={t('search')} placeholder={t('filterPlaceholder')} value={query} onChange={(event) => { setQuery(event.target.value) }} /></div>{fileTable(filtered)}</div> : page === 'templates' ? <div className={`${css.page} ${css.templatePage}`}><h1>{t('templates')}</h1><p className={css.subtitle}>{t('taskHint')}</p><div className={css.taskGrid}>{templateButtons}</div><p className={css.templateNotice}>{t('taskScopeHint')}</p></div> : page === 'trash' ? <div className={css.page}><h1>{t('trash')}</h1><p className={css.subtitle}>{t('trashHint')}</p>{snapshot.trash.length === 0 ? <div className={css.emptyState}><IconTrashOutlineRegular size={28} /><h2>{t('trashEmpty')}</h2><p>{t('trashEmptyHint')}</p></div> : <div className={css.tableWrap}><table className={css.table}><thead><tr><th>{t('filename')}</th><th>{t('originalProject')}</th><th>{t('deleted')}</th><th>{t('actions')}</th></tr></thead><tbody>{snapshot.trash.map(item => <tr key={item.id}><td><button className={css.fileName} onClick={() => { begin({ kind: 'preview', markdown: item.markdown, file: item.file }) }}>{plain(item.file)}</button></td><td>{item.project}</td><td>{date(item.deletedAt)}</td><td><div className={css.rowActions}>{button('restore', () => { void restore(item) })}{iconButton('permanent', () => { begin({ kind: 'purge', deleted: item }) }, <IconTrashOutlineRegular size={13} />)}</div></td></tr>)}</tbody></table></div>}</div> : page === 'settings' ? settingsPage : project === undefined ? <div className={css.emptyState}><h2>{t('missing')}</h2>{button('back', () => { navigate('home') })}</div> : null}
        <div className={`${css.projectLayout} ${view.tab === 'chat' ? css.chatOnly : ''} ${focus ? css.focusLayout : ''}`} hidden={page !== 'project' || project === undefined}>
          <section className={css.documentPane} hidden={view.tab === 'chat'}>
            {view.tab === 'overview' || view.file === null ? <div className={css.overview}><div className={css.overviewHeading}><span className={css.marker}><IconFolderCloseRegular size={17} /></span><h1>{project?.name}</h1></div><p className={css.subtitle}>{t('overviewHint')}</p>{project?.documents.length === 0 ? <div className={css.emptyState}><span className={css.orb}><AipmMark size={30} /></span><h2>{t('emptyProject')}</h2><p>{t('emptyHint')}</p>{button('continue', () => { saveSiminView({ ...view, tab: 'chat' }) }, true)}</div> : <><h2>{t('evidence')}</h2>{project?.files.map(file => <button key={file.name} className={css.overviewDoc} onClick={() => { saveSiminView({ ...view, file: file.name, tab: 'document' }) }}><IconDeliverDocRegular size={17} /><div><h3>{plain(file.name)}</h3><p>{file.preview}</p></div><IconChevronRightOutlineRegular size={13} /></button>)}</>}<div className={css.hint}>{t('questionsHint')}</div><div className={css.folderPath}><span>{t('folder')}</span><code>{project?.path}</code>{iconButton('pathCopy', () => { void copy(project?.path ?? '') }, <IconCopyOutlineRegular size={13} />)}</div></div> : <><div className={css.docToolbar}><h1>{plain(view.file)}</h1><span className={css.headerSpacer} />{iconButton(source ? 'markdown' : 'source', () => { setSource(!source) }, <IconCodeOutlineRegular size={15} />)}{iconButton('copy', () => { void copy(document?.markdown ?? '') }, <IconCopyOutlineRegular size={15} />)}{iconButton('download', download, <IconDeliverDocRegular size={15} />)}{iconButton(focus ? 'exitFocus' : 'focus', () => { setFocus(!focus) }, <IconFullscreenOutlineRegular size={15} />)}</div><div className={css.docActions}>{button('continue', () => { saveSiminView({ ...view, tab: 'chat' }) })}{button('quote', () => { if (project !== undefined && document !== null) { const selected = window.getSelection()?.toString(); draftToProject(project, selected ? `> ${selected}\n\n${view.file ?? ''}` : t('quotePrompt', { file: view.file ?? '' })) } })}{button('rename', () => { if (project !== undefined && view.file !== null && document !== null) begin({ kind: 'rename', project: project.name, file: view.file, version: document.version }) })}</div><article className={css.docBody}>{fileError && <p className={css.notice}>{t('fileError')}</p>}{document === null && !fileError ? <div className={css.loading}><span className={css.spinner} /></div> : source ? <pre>{document?.markdown}</pre> : <Reading text={document?.markdown ?? ''} t={t} />}</article></>}
          </section>
          <section className={css.chatPane} hidden={focus}>
            <div className={css.projectTaskBar}><span>{t('projectTasks')}</span>{(['prd', 'initiation', 'evaluation'] as const).map(kind => <button key={kind} onClick={() => { startTask(kind) }}>{t(`${kind}Title`)}</button>)}</div>
            {proposalRows.map(item => <div key={item.id} className={css.proposalCard}><div><strong>{t(item.status === 'pending' ? 'pending' : item.status === 'interrupted' ? 'interrupted' : 'failedProposal')}</strong><small>{item.file}</small></div>{button('preview', () => { begin({ kind: 'preview', proposal: item, file: item.file }) }, true)}</div>)}
            {workspace === 'error' && <div className={css.notice}>{t('workspaceError')}{button('retry', retryWorkspace)}</div>}
            <div className={css.chatContent} hidden={workspace !== 'ready'}>{chat}</div>
            {workspace === 'loading' && <div className={css.loading} aria-label={t('preparing')}><span className={css.spinner} /></div>}
          </section>
        </div>
      </div>
    </main>
    <div className={css.nativeHost}>{nativeSettings}</div>
    {toast !== null && <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />}
    <Modal open={dialog !== null} onClose={closeDialog} title={t(dialogKey)} closeLabel={t('close')} className={css.dialog ?? ''} footer={dialog?.kind === 'preview' && dialog.proposal === undefined ? button('close', closeDialog) : <>{dialog?.proposal === undefined ? button('cancel', closeDialog) : <button className={css.button} disabled={busy} onClick={() => { void reject() }}>{t('cancel')}</button>}<button className={css.primary} disabled={busy} onClick={() => { void commit() }}>{t(busy ? 'busy' : dialog?.kind === 'create' ? 'create' : dialog?.kind === 'rename' ? 'rename' : dialog?.kind === 'trash' ? 'remove' : dialog?.kind === 'purge' ? 'permanent' : dialog?.kind === 'template' ? 'taskStart' : dialog?.kind === 'newDoc' && !previewing ? 'preview' : 'confirm')}</button></>}>
      {dialog?.kind === 'create' && <><label className={css.field}>{t('projectName')}<input data-modal-autofocus value={nameDraft} placeholder={t('namePlaceholder')} onChange={(event) => { setNameDraft(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter') void commit() }} /></label><label className={css.field}>{t('idea')}<textarea value={ideaDraft} placeholder={t('ideaPlaceholder')} onChange={(event) => { setIdeaDraft(event.target.value) }} /></label><p className={css.hint}>{t('createHint')}</p></>}
      {dialog?.kind === 'rename' && <><p>{t('renameHint')}</p><label className={css.field}>{t('filename')}<input data-modal-autofocus value={nameDraft} onChange={(event) => { setNameDraft(event.target.value) }} /></label></>}
      {dialog?.kind === 'trash' && <p>{dialog.file}<br />{t('removeHint')}</p>}
      {dialog?.kind === 'purge' && <p>{dialog.deleted?.file}<br />{t('permanentHint')}</p>}
      {dialog?.kind === 'newDoc' && (!previewing ? <><label className={css.field}>{t('filename')}<input data-modal-autofocus value={nameDraft} onChange={(event) => { setNameDraft(event.target.value) }} /></label><label className={css.field}>{t('content')}<textarea className={css.editor} value={bodyDraft} onChange={(event) => { setBodyDraft(event.target.value) }} /></label></> : <><h3>{nameDraft}</h3><Reading text={bodyDraft} t={t} /><p className={css.hint}>{t('proposalHint')}</p></>)}
      {dialog?.kind === 'template' && <>
        <div className={css.taskSummary}><span><small>{t('taskOutput')}</small><strong>{t(`${dialog.template ?? 'initiation'}Output`)}</strong></span><p>{t(`${dialog.template ?? 'initiation'}Sections`)}</p></div>
        <label className={css.field}>{t('taskProject')}<select data-modal-autofocus value={targetProject} onChange={(event) => { setTargetProject(event.target.value) }}><option value="">{t('newProjectOption')}</option>{snapshot.projects.map(item => <option key={item.path}>{item.name}</option>)}</select></label>
        {targetProject === '' && <label className={css.field}>{t('projectName')}<input value={nameDraft} placeholder={t('namePlaceholder')} onChange={(event) => { setNameDraft(event.target.value) }} /></label>}
        <label className={css.field}>{t('taskBrief')}<textarea value={bodyDraft} placeholder={t('taskBriefPlaceholder')} onChange={(event) => { setBodyDraft(event.target.value) }} /></label><p className={css.hint}>{t('taskStartHint')}</p>
      </>}
      {dialog?.kind === 'preview' && <><h3>{dialog.file}</h3>{dialog.proposal?.before !== null && dialog.proposal?.before !== undefined ? <DiffBlock diffs={[{ path: dialog.proposal.file, oldText: dialog.proposal.before, newText: dialog.proposal.after }]} maxLines={80} labels={{ codeLabel: t('diff'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap'), copy: t('copy'), copied: t('copied'), collapseAria: t('collapse'), collapse: t('collapse'), expandAria: count => t('expand', { count }), expand: count => t('expand', { count }) }} /> : <Reading text={dialog.proposal?.after ?? dialog.markdown ?? ''} t={t} />}{dialog.proposal !== undefined && <p className={css.hint}>{t('proposalHint')}</p>}</>}
      {formError && <p className={css.formError} role="alert">{formError}</p>}
    </Modal>
    <Modal open={searchOpen} onClose={() => { setSearchOpen(false) }} title={t('search')} closeLabel={t('close')} className={css.searchDialog ?? ''}><input data-modal-autofocus className={css.searchInput} aria-label={t('search')} placeholder={t('searchHint')} value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSearchIndex(0); setHits([]); setSearchError(false) }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSearchIndex(index => Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))) }
      if (event.key === 'Enter') { results[searchIndex]?.open(); setSearchOpen(false) }
    }} /><div className={css.searchResults}>{results.map((result, index) => <button key={result.key} className={`${css.searchResult} ${index === searchIndex ? css.active : ''}`} onClick={() => { result.open(); setSearchOpen(false) }}><strong>{result.label}<small>{result.kind}</small></strong><p>{result.snippet}</p></button>)}{searchQuery && results.length === 0 && <p className={css.hint}>{t('noResults')}</p>}{searchError && <p className={css.formError}>{t('searchError')}</p>}</div></Modal>
  </div>
}
