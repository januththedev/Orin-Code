/**
 * The command model, ported from ZCode's
 * `packages/ui/src/quickpick/quickPickCommands.ts`.
 *
 * Preserved deliberately, because each of these is a behaviour rather than a
 * detail:
 *
 *   - ids, sections and section ORDER (`QUICK_PICK_SECTION_ORDER`);
 *   - the capability filter that drops terminal commands when there is no
 *     terminal and the review command when review is unsupported;
 *   - `disabled` as the way to show a command that exists but cannot run, as
 *     opposed to omitting it;
 *   - the switch-theme title and icon flipping on the *target* theme;
 *   - keywords carrying a second language, so the palette is searchable in
 *     either.
 */

export type QuickPickCommandIcon =
  | 'book'
  | 'browser'
  | 'community'
  | 'diff'
  | 'feedback'
  | 'folder'
  | 'login'
  | 'logout'
  | 'message'
  | 'mcp'
  | 'settings'
  | 'sidebarClose'
  | 'sidebarOpen'
  | 'skills'
  | 'themeDark'
  | 'themeLight'
  | 'terminal'

export type QuickPickCommandSectionId = 'suggested' | 'chat' | 'navigation' | 'panels' | 'configure' | 'app'

export const QUICK_PICK_SECTION_ORDER: QuickPickCommandSectionId[] = [
  'suggested',
  'chat',
  'navigation',
  'panels',
  'configure',
  'app',
]

export interface QuickPickCommand {
  id: string
  sectionId: QuickPickCommandSectionId
  /** Rendered label. ZCode stores an i18n id; Orin Code resolves inline. */
  title: string
  icon: QuickPickCommandIcon
  /** Pre-formatted display label, NOT a binding -- it reflects user overrides. */
  shortcut?: string
  keywords: string[]
  disabled?: boolean
  run: () => void | Promise<void>
}

export interface QuickPickCommandHandlers {
  createTask: () => void
  openWorkspace: () => void
  openSettings: () => void
  openSkillsSettings: () => void
  openMcpSettings: () => void
  switchTheme: () => void
  openFeedback: () => void | Promise<void>
  openCommunity: () => void | Promise<void>
  openProductDocs: () => void | Promise<void>
  login?: () => void | Promise<void>
  logout?: () => void | Promise<void>
  toggleSidebar: () => void
  toggleTerminal: () => void
  togglePreview: () => void
  openTerminalTab: () => void
  openBrowserTab: () => void
  openReviewTab: () => void
}

export interface CreateQuickPickCommandsOptions {
  allowOpenWorkspace: boolean
  canOpenCommunity: boolean
  isSidebarVisible: boolean
  isLoggedIn: boolean
  supportsEmbeddedBrowser?: boolean
  supportsTerminal?: boolean
  supportsReview?: boolean
  themeTarget: 'dark' | 'light'
  /** Display labels for the four shortcuts the palette shows, already resolved. */
  shortcuts: {
    newTask: string
    openWorkspace: string
    toggleSidebar: string
    toggleTerminal: string
  }
  handlers: QuickPickCommandHandlers
}

export function createQuickPickCommands({
  allowOpenWorkspace,
  canOpenCommunity,
  isSidebarVisible,
  isLoggedIn,
  supportsEmbeddedBrowser = true,
  supportsTerminal = true,
  supportsReview = true,
  themeTarget,
  shortcuts,
  handlers,
}: CreateQuickPickCommandsOptions): QuickPickCommand[] {
  const commands: QuickPickCommand[] = [
    {
      id: 'new-task',
      sectionId: 'suggested',
      title: 'New task',
      icon: 'message',
      shortcut: shortcuts.newTask,
      keywords: ['new', 'task', '任务', '新任务', '新建任务'],
      run: handlers.createTask,
    },
    {
      id: 'open-workspace',
      sectionId: 'suggested',
      title: 'Open workspace',
      icon: 'folder',
      shortcut: shortcuts.openWorkspace,
      keywords: ['open', 'workspace', 'folder', 'project', '打开', '文件夹', '项目'],
      disabled: !allowOpenWorkspace,
      run: handlers.openWorkspace,
    },
    {
      id: 'suggested-settings',
      sectionId: 'suggested',
      title: 'Settings',
      icon: 'settings',
      keywords: ['settings', 'preferences', '配置', '设置'],
      run: handlers.openSettings,
    },
    {
      id: 'toggle-sidebar',
      sectionId: 'panels',
      title: 'Toggle sidebar',
      icon: isSidebarVisible ? 'sidebarClose' : 'sidebarOpen',
      shortcut: shortcuts.toggleSidebar,
      keywords: ['sidebar', 'left sidebar', 'toggle sidebar', '侧栏', '侧边栏', '切换侧栏'],
      run: handlers.toggleSidebar,
    },
    {
      id: 'toggle-terminal',
      sectionId: 'panels',
      title: 'Toggle terminal',
      icon: 'terminal',
      shortcut: shortcuts.toggleTerminal,
      keywords: ['terminal', 'shell', 'console', '终端'],
      run: handlers.toggleTerminal,
    },
    ...(supportsEmbeddedBrowser
      ? [
          {
            id: 'toggle-preview',
            sectionId: 'panels',
            title: 'Toggle preview',
            icon: 'browser',
            keywords: ['preview', 'browser', 'web', 'show', 'hide', '预览', '浏览器', '网页', '显示', '隐藏'],
            run: handlers.togglePreview,
          } satisfies QuickPickCommand,
        ]
      : []),
    {
      id: 'add-terminal-tab',
      sectionId: 'panels',
      title: 'Add terminal tab',
      icon: 'terminal',
      keywords: ['add', 'terminal', 'tab', 'new terminal', '添加终端', '终端标签'],
      run: handlers.openTerminalTab,
    },
    ...(supportsEmbeddedBrowser
      ? [
          {
            id: 'add-browser-tab',
            sectionId: 'panels',
            title: 'Add browser tab',
            icon: 'browser',
            keywords: ['add', 'browser', 'tab', 'preview', '添加浏览器', '浏览器标签'],
            run: handlers.openBrowserTab,
          } satisfies QuickPickCommand,
        ]
      : []),
    {
      id: 'add-review-tab',
      sectionId: 'panels',
      title: 'Add review tab',
      icon: 'diff',
      keywords: ['add', 'review', 'diff', 'changes', '添加审查', '审查标签', '变更'],
      run: handlers.openReviewTab,
    },
    {
      id: 'settings',
      sectionId: 'configure',
      title: 'Settings',
      icon: 'settings',
      keywords: ['settings', 'preferences', '配置', '设置'],
      run: handlers.openSettings,
    },
    {
      // The title names the TARGET theme, not the current one, and the icon
      // flips with it. Preserved because it is easy to get backwards.
      id: 'switch-theme',
      sectionId: 'configure',
      title: themeTarget === 'dark' ? 'Switch theme to dark' : 'Switch theme to light',
      icon: themeTarget === 'dark' ? 'themeDark' : 'themeLight',
      keywords: ['theme', 'dark', 'light', '主题', '深色', '浅色'],
      run: handlers.switchTheme,
    },
    {
      id: 'skills-settings',
      sectionId: 'configure',
      title: 'Skills',
      icon: 'skills',
      keywords: ['skills', 'skill', '配置', '技能'],
      run: handlers.openSkillsSettings,
    },
    {
      id: 'mcp-settings',
      sectionId: 'configure',
      title: 'MCP Servers',
      icon: 'mcp',
      keywords: ['mcp', 'server', 'servers', 'MCP', '服务器'],
      run: handlers.openMcpSettings,
    },
  ]

  // Orin Code has no feedback channel, community link or docs page wired to a
  // platform command the way ZCode's do. They stay in the model with ZCode's
  // ids, section and keywords, and use ZCode's own `disabled` mechanism rather
  // than being dropped: a greyed row says "not available here", a missing row
  // makes the palette look broken.
  commands.push({
    id: 'feedback',
    sectionId: 'app',
    title: 'Feedback',
    icon: 'feedback',
    keywords: ['feedback', 'issue', 'support', 'tickets', '问题上报', '问题反馈', '反馈', '我的反馈', '工单'],
    disabled: true,
    run: handlers.openFeedback,
  })

  if (canOpenCommunity) {
    commands.push({
      id: 'community',
      sectionId: 'app',
      title: 'Community',
      icon: 'community',
      keywords: ['community', 'users', 'chat', '用户社群', '社群'],
      run: handlers.openCommunity,
    })
  }

  commands.push({
    id: 'product-docs',
    sectionId: 'app',
    title: 'Product docs',
    icon: 'book',
    keywords: ['docs', 'documentation', 'product docs', '文档', '产品文档'],
    disabled: true,
    run: handlers.openProductDocs,
  })

  // Mutually exclusive, exactly as in ZCode: signed in offers Disconnect, not
  // both, and the keywords follow the wording shown to the user.
  if (isLoggedIn && handlers.logout) {
    commands.push({
      id: 'logout',
      sectionId: 'app',
      title: 'Disconnect',
      icon: 'logout',
      keywords: ['disconnect', 'logout', 'sign out', '断开连接', '登出'],
      run: handlers.logout,
    })
  } else if (!isLoggedIn && handlers.login) {
    commands.push({
      id: 'login',
      sectionId: 'app',
      title: 'Connect',
      icon: 'login',
      keywords: ['connect', 'login', 'sign in', '连接', '登录'],
      run: handlers.login,
    })
  }

  // Capability filter last, so a command declared above can still be dropped.
  return commands.filter(
    (command) =>
      (supportsTerminal || (command.id !== 'toggle-terminal' && command.id !== 'add-terminal-tab')) &&
      (supportsReview || command.id !== 'add-review-tab'),
  )
}