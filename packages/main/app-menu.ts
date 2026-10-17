import type { MenuItemConstructorOptions } from 'electron';

export type MenuT = (
  key: string,
  vars?: Record<string, string | number | null | undefined>,
  defaultValue?: string
) => string;

export interface AppMenuActions {
  newTab: () => void;
  closeTab: () => void;
  selectRelativeTab: (delta: number) => void;
  selectTabAtIndex: (index: number) => void;
  showFindBar: () => void;
}

export interface AppMenuOptions {
  platform: NodeJS.Platform;
  isDev: boolean;
  appName: string;
  t: MenuT;
  actions: AppMenuActions;
}

/**
 * The native application menu, in the app's UI language. Every item carries
 * an explicit label (role items otherwise follow the OS language, not the
 * app's), and the menu is rebuilt whenever the UI language changes.
 */
export function buildAppMenuTemplate({
  platform,
  isDev,
  appName,
  t,
  actions,
}: AppMenuOptions): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin';
  const app = { app: appName };
  const role = (
    r: MenuItemConstructorOptions['role'],
    key: string,
    fallback: string,
    extra: Partial<MenuItemConstructorOptions> = {}
  ): MenuItemConstructorOptions => ({
    role: r,
    label: t(key, app, fallback),
    ...extra,
  });
  const separator: MenuItemConstructorOptions = { type: 'separator' };

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: appName,
          submenu: [
            role('about', 'menu.about', 'About {{app}}'),
            separator,
            role('services', 'menu.services', 'Services'),
            separator,
            role('hide', 'menu.hide', 'Hide {{app}}'),
            role('hideOthers', 'menu.hideOthers', 'Hide Others'),
            role('unhide', 'menu.showAll', 'Show All'),
            separator,
            role('quit', 'menu.quit', 'Quit {{app}}'),
          ],
        },
      ]
    : [];

  return [
    ...appMenu,
    {
      label: t('menu.file', undefined, 'File'),
      submenu: [
        {
          label: t('menu.newTab', undefined, 'New Tab'),
          accelerator: 'CmdOrCtrl+T',
          click: () => actions.newTab(),
        },
        {
          label: t('menu.closeTab', undefined, 'Close Tab'),
          accelerator: 'CmdOrCtrl+W',
          click: () => actions.closeTab(),
        },
        separator,
        {
          label: t('menu.nextTab', undefined, 'Next Tab'),
          accelerator: 'Ctrl+Tab',
          click: () => actions.selectRelativeTab(1),
        },
        {
          label: t('menu.previousTab', undefined, 'Previous Tab'),
          accelerator: 'Ctrl+Shift+Tab',
          click: () => actions.selectRelativeTab(-1),
        },
        separator,
        // Cmd+W belongs to Close Tab; the window close gets Shift+Cmd+W
        // (browser convention) so the accelerators never collide.
        isMac
          ? role('close', 'menu.closeWindow', 'Close Window', {
              accelerator: 'Shift+CmdOrCtrl+W',
            })
          : role('quit', 'menu.exit', 'Exit'),
      ],
    },
    {
      label: t('menu.edit', undefined, 'Edit'),
      submenu: [
        role('undo', 'menu.undo', 'Undo'),
        role('redo', 'menu.redo', 'Redo'),
        separator,
        role('cut', 'menu.cut', 'Cut'),
        role('copy', 'menu.copy', 'Copy'),
        role('paste', 'menu.paste', 'Paste'),
        ...(isMac
          ? [
              role(
                'pasteAndMatchStyle',
                'menu.pasteAndMatchStyle',
                'Paste and Match Style'
              ),
              role('delete', 'menu.delete', 'Delete'),
              role('selectAll', 'menu.selectAll', 'Select All'),
              separator,
              {
                label: t('menu.speech', undefined, 'Speech'),
                submenu: [
                  role('startSpeaking', 'menu.startSpeaking', 'Start Speaking'),
                  role('stopSpeaking', 'menu.stopSpeaking', 'Stop Speaking'),
                ],
              },
            ]
          : [
              role('delete', 'menu.delete', 'Delete'),
              separator,
              role('selectAll', 'menu.selectAll', 'Select All'),
            ]),
        separator,
        {
          label: t('menu.find', undefined, 'Find'),
          accelerator: 'CmdOrCtrl+F',
          click: () => actions.showFindBar(),
        },
      ],
    },
    {
      label: t('menu.view', undefined, 'View'),
      submenu: [
        ...(isDev
          ? ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
          : []),
        separator,
        role('resetZoom', 'menu.actualSize', 'Actual Size'),
        role('zoomIn', 'menu.zoomIn', 'Zoom In'),
        role('zoomOut', 'menu.zoomOut', 'Zoom Out'),
        separator,
        role('togglefullscreen', 'menu.toggleFullScreen', 'Toggle Full Screen'),
      ],
    },
    {
      label: t('menu.window', undefined, 'Window'),
      submenu: [
        ...Array.from(
          { length: 9 },
          (_, i): MenuItemConstructorOptions => ({
            label: t('menu.selectTab', { n: i + 1 }, 'Select Tab {{n}}'),
            accelerator: `CmdOrCtrl+${i + 1}`,
            visible: false,
            acceleratorWorksWhenHidden: true,
            click: () => actions.selectTabAtIndex(i === 8 ? -1 : i),
          })
        ),
        role('minimize', 'menu.minimize', 'Minimize'),
        role('zoom', 'menu.zoom', 'Zoom'),
        ...(isMac
          ? [
              separator,
              role('front', 'menu.bringAllToFront', 'Bring All to Front'),
              separator,
              // Electron's documented marker for the open-window list.
              { role: 'window' } as MenuItemConstructorOptions,
            ]
          : [
              // Ctrl+W belongs to Close Tab; see the File menu note.
              role('close', 'menu.closeWindow', 'Close Window', {
                accelerator: 'Shift+CmdOrCtrl+W',
              }),
            ]),
      ],
    },
  ];
}

/** Labels for the right-click menu (electron-context-menu), same language. */
export function buildContextMenuLabels(t: MenuT): Record<string, string> {
  return {
    cut: t('menu.cut', undefined, 'Cut'),
    copy: t('menu.copy', undefined, 'Copy'),
    paste: t('menu.paste', undefined, 'Paste'),
    selectAll: t('menu.selectAll', undefined, 'Select All'),
    learnSpelling: t('menu.learnSpelling', undefined, 'Learn Spelling'),
    lookUpSelection: t(
      'menu.lookUpSelection',
      undefined,
      'Look Up “{selection}”'
    ),
    searchWithGoogle: t(
      'menu.searchWithGoogle',
      undefined,
      'Search with Google'
    ),
    saveImage: t('menu.saveImage', undefined, 'Save Image'),
    saveImageAs: t('menu.saveImageAs', undefined, 'Save Image As…'),
    saveVideo: t('menu.saveVideo', undefined, 'Save Video'),
    saveVideoAs: t('menu.saveVideoAs', undefined, 'Save Video As…'),
    copyLink: t('menu.copyLink', undefined, 'Copy Link'),
    saveLinkAs: t('menu.saveLinkAs', undefined, 'Save Link As…'),
    copyImage: t('menu.copyImage', undefined, 'Copy Image'),
    copyImageAddress: t(
      'menu.copyImageAddress',
      undefined,
      'Copy Image Address'
    ),
    copyVideoAddress: t(
      'menu.copyVideoAddress',
      undefined,
      'Copy Video Address'
    ),
    inspect: t('menu.inspect', undefined, 'Inspect Element'),
    services: t('menu.services', undefined, 'Services'),
  };
}

/** The new-tab shortcut as each platform writes it. */
export function newTabShortcutLabel(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? '⌘T' : 'Ctrl+T';
}
