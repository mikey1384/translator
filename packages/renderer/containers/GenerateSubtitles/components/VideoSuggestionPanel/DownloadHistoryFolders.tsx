import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { css } from '@emotion/css';
import * as FolderIPC from '../../../../ipc/download-folders.js';
import { FolderInput, FolderPlus, LockKeyhole, Play } from 'lucide-react';
import type {
  DownloadFolderInfo,
  DownloadFolderRequest,
  VideoSuggestionDownloadHistoryItem,
} from '@shared-types/app';
import Button from '../../../../components/Button';
import Modal from '../../../../components/Modal';
import { colors } from '../../../../styles';
import { openNotice } from '../../../../state/modal-store';
import { syncAuthoritativeVideoSuggestionHistory } from './video-suggestion-local-storage';

const toolbar = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
`;
const field = css`
  padding: 10px 12px;
  max-width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  background: ${colors.surface};
  color: ${colors.text};
  border: 1px solid ${colors.border};
  font: inherit;
`;
const form = css`
  display: flex;
  flex-direction: column;
  gap: 14px;
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  p {
    font-size: 13px;
    line-height: 1.5;
    color: ${colors.textDim};
    margin: 0;
  }
  input[type='checkbox'] {
    margin-inline-end: 8px;
  }
  [role='alert'] {
    color: ${colors.danger};
  }
`;
const row = css`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid ${colors.border};
  border-radius: 10px;
  margin-bottom: 8px;
  span {
    flex: 1;
    overflow-wrap: anywhere;
  }
`;
type DialogState = {
  kind: 'create' | 'rename' | 'unlock' | 'move';
  item?: VideoSuggestionDownloadHistoryItem;
} | null;

export function useDownloadFolders(
  t: TFunction,
  history: VideoSuggestionDownloadHistoryItem[]
) {
  const [folders, setFolders] = useState<DownloadFolderInfo[]>([]);
  const [selected, setSelected] = useState('');
  const [entries, setEntries] = useState<
    { id: string; title: string; ready: boolean }[]
  >([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const epoch = useRef(0);
  const folder = folders.find(f => f.id === selected);
  const label = (f: DownloadFolderInfo) =>
    f.name ||
    `${t('libraryFolders.privateFolder')} ${folders.filter(x => x.private).findIndex(x => x.id === f.id) + 1}`;
  const message = (code: string) =>
    t(
      `libraryFolders.errors.${code}`,
      t('libraryFolders.errors.storage_failed')
    );
  const request = useCallback(async (r: DownloadFolderRequest) => {
    const result = await FolderIPC.downloadFolder(r);
    if (!result.success) throw new Error(result.error || 'storage_failed');
    return result;
  }, []);
  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    const result = await request({ action: 'list' });
    if (!mounted.current || current !== epoch.current) return;
    setFolders(result.folders || []);
    const active = result.folders?.find(f => f.id === selected);
    if (active?.private && !active.locked) {
      const contents = await request({ action: 'entries', folderId: selected });
      if (mounted.current && current === epoch.current)
        setEntries(contents.entries || []);
    } else setEntries([]);
  }, [request, selected]);
  useEffect(() => {
    const requestEpoch = epoch;
    mounted.current = true;
    void refresh().catch(() => {});
    const off = FolderIPC.onDownloadFoldersChanged(() => {
      setEntries([]);
      void refresh().catch(() => {});
      void syncAuthoritativeVideoSuggestionHistory().catch(() => {});
    });
    return () => {
      mounted.current = false;
      requestEpoch.current++;
      off();
    };
  }, [refresh]);
  const close = () => {
    if (busy) return;
    setDialog(null);
    setPassword('');
    setConfirm('');
    setName('');
    setError('');
  };
  const show = (d: NonNullable<DialogState>) => {
    setDialog(d);
    setError('');
    setPassword('');
    setConfirm('');
    setPrivate(false);
    setName(d.kind === 'rename' ? folder?.name || '' : '');
    setDestination(d.item?.folderId || '');
  };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (e: any) {
      setError(message(e.message));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const submit = () =>
    void run(async () => {
      if (!dialog) return;
      if (dialog.kind === 'create') {
        if (isPrivate && password !== confirm)
          throw new Error('password_mismatch');
        const result = await request({
          action: 'create',
          name,
          private: isPrivate,
          ...(isPrivate ? { password } : {}),
        });
        setSelected(result.folderId || '');
      } else if (dialog.kind === 'rename')
        await request({ action: 'rename', folderId: selected, name });
      else if (dialog.kind === 'unlock')
        await request({ action: 'unlock', folderId: selected, password });
      else if (dialog.item) {
        const target = folders.find(f => f.id === destination);
        if (target?.private && target.locked)
          await request({ action: 'unlock', folderId: destination, password });
        await request({
          action: 'move',
          folderId: destination,
          itemId: dialog.item.id,
        });
        await syncAuthoritativeVideoSuggestionHistory();
        setSelected(destination);
      }
      setDialog(null);
      setPassword('');
      setConfirm('');
      setName('');
    });
  const needsPassword =
    (dialog?.kind === 'create' && isPrivate) ||
    dialog?.kind === 'unlock' ||
    (dialog?.kind === 'move' &&
      folders.find(f => f.id === destination)?.locked);
  const movingPrivate =
    dialog?.kind === 'move' && folders.find(f => f.id === destination)?.private;
  const title =
    dialog?.kind === 'create'
      ? t('libraryFolders.newFolder')
      : dialog?.kind === 'rename'
        ? t('libraryFolders.rename')
        : dialog?.kind === 'unlock'
          ? t('libraryFolders.unlock')
          : t('libraryFolders.move');
  const remove = async (entryId?: string) => {
    const result = await openNotice({
      title: t('common.delete'),
      message: entryId
        ? t('libraryFolders.deleteVideoConfirm')
        : t('libraryFolders.deleteFolderConfirm'),
      buttons: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'delete', label: t('common.delete'), variant: 'danger' },
      ],
    });
    if (result !== 'delete') return;
    await run(async () => {
      await request(
        entryId
          ? { action: 'delete-entry', folderId: selected, entryId }
          : { action: 'delete-folder', folderId: selected }
      );
      if (!entryId) setSelected('');
    });
  };
  const saveCopy = async (entryId: string) => {
    const answer = await openNotice({
      title: t('libraryFolders.saveCopy'),
      message: t('libraryFolders.exportConfirm'),
      buttons: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'save', label: t('libraryFolders.saveCopy') },
      ],
    });
    if (answer !== 'save') return;
    await run(async () => {
      await request({
        action: 'export',
        folderId: selected,
        entryId,
        title: t('libraryFolders.saveCopy'),
      });
    });
  };
  const controls = (
    <>
      <div className={toolbar}>
        <select
          className={field}
          aria-label={t('libraryFolders.folders')}
          value={selected}
          onChange={e => {
            setEntries([]);
            setError('');
            setSelected(e.target.value);
          }}
          disabled={busy}
        >
          <option value="">{t('libraryFolders.allVideos')}</option>
          <option value="unfiled">{t('libraryFolders.unfiled')}</option>
          {folders.map(f => (
            <option key={f.id} value={f.id}>
              {f.private ? '🔒 ' : ''}
              {label(f)}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<FolderPlus size={16} />}
          onClick={() => show({ kind: 'create' })}
          disabled={busy}
        >
          {t('libraryFolders.newFolder')}
        </Button>
        {folder && (!folder.private || !folder.locked) && (
          <>
            {folder.private && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<LockKeyhole size={15} />}
                onClick={() =>
                  void request({ action: 'lock', folderId: selected }).then(
                    refresh
                  )
                }
              >
                {t('libraryFolders.lock')}
              </Button>
            )}
            <details>
              <summary>{t('common.moreActions')}</summary>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => show({ kind: 'rename' })}
              >
                {t('libraryFolders.rename')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void remove()}
                disabled={busy}
              >
                {t('common.delete')}
              </Button>
            </details>
          </>
        )}
      </div>
      {error && !dialog && <p role="alert">{error}</p>}
      {folder?.private &&
        (folder.locked ? (
          <div className={row}>
            <LockKeyhole size={24} />
            <span>{t('libraryFolders.lockedHint')}</span>
            <Button onClick={() => show({ kind: 'unlock' })}>
              {t('libraryFolders.unlock')}
            </Button>
          </div>
        ) : (
          <>
            {!entries.length && <p>{t('libraryFolders.empty')}</p>}
            {entries.map(entry => (
              <div key={entry.id} className={row}>
                <span>
                  {entry.title}
                  {!entry.ready && (
                    <small> — {t('libraryFolders.pending')}</small>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Play size={15} />}
                  disabled={busy || !entry.ready}
                  onClick={() =>
                    void run(async () => {
                      await request({
                        action: 'open',
                        folderId: selected,
                        entryId: entry.id,
                        labels: {
                          lock: t('libraryFolders.lock'),
                          privateFolder: t('libraryFolders.privateFolder'),
                        },
                      });
                    })
                  }
                >
                  {t('libraryFolders.watch')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void saveCopy(entry.id)}
                >
                  {t('libraryFolders.saveCopy')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy || !entry.ready}
                  onClick={() => void remove(entry.id)}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ))}
            {folder.pending && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => show({ kind: 'unlock' })}
              >
                {t('common.retry')}
              </Button>
            )}
          </>
        ))}
      <Modal
        open={!!dialog}
        title={title}
        titleId="download-folder-dialog"
        onClose={close}
        actions={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={submit}
              disabled={
                busy ||
                ((dialog?.kind === 'create' || dialog?.kind === 'rename') &&
                  !name.trim()) ||
                (!!needsPassword && !password) ||
                (dialog?.kind === 'move' && !folders.length)
              }
            >
              {busy
                ? t('common.wait')
                : dialog?.kind === 'unlock'
                  ? t('libraryFolders.unlock')
                  : dialog?.kind === 'move'
                    ? t('libraryFolders.move')
                    : t('common.save')}
            </Button>
          </>
        }
      >
        <form
          className={form}
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          {(dialog?.kind === 'create' || dialog?.kind === 'rename') && (
            <label>
              {t('libraryFolders.name')}
              <input
                className={field}
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={80}
                disabled={busy}
              />
            </label>
          )}
          {dialog?.kind === 'create' && (
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={e => setPrivate(e.target.checked)}
                disabled={busy}
              />
              {t('libraryFolders.privateFolder')}
            </label>
          )}
          {dialog?.kind === 'move' && (
            <label>
              {t('libraryFolders.folders')}
              <select
                className={field}
                value={destination}
                onChange={e => {
                  setDestination(e.target.value);
                  setPassword('');
                }}
                disabled={busy}
              >
                <option value="">{t('libraryFolders.unfiled')}</option>
                {folders.map(f => (
                  <option
                    key={f.id}
                    value={f.id}
                    disabled={f.private && !dialog.item?.managedLocalFile}
                  >
                    {f.private ? '🔒 ' : ''}
                    {label(f)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(isPrivate || movingPrivate) && (
            <p>{t('libraryFolders.protectionHint')}</p>
          )}
          {needsPassword && (
            <label>
              {t('libraryFolders.password')}
              <input
                className={field}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={
                  dialog?.kind === 'create'
                    ? 'new-password'
                    : 'current-password'
                }
                maxLength={256}
                disabled={busy}
              />
            </label>
          )}
          {dialog?.kind === 'create' && isPrivate && (
            <>
              <label>
                {t('libraryFolders.confirmPassword')}
                <input
                  className={field}
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  maxLength={256}
                  disabled={busy}
                />
              </label>
              <p>{t('libraryFolders.passwordHint')}</p>
            </>
          )}
          {busy && movingPrivate && (
            <p role="status">{t('libraryFolders.protecting')}</p>
          )}
          {error && <p role="alert">{error}</p>}
        </form>
      </Modal>
    </>
  );
  return {
    controls,
    privateSelected: !!folder?.private,
    visibleItems: history.filter(item =>
      selected === 'unfiled'
        ? !item.folderId
        : !selected || item.folderId === selected
    ),
    moveButton: (item: VideoSuggestionDownloadHistoryItem) => (
      <Button
        size="sm"
        variant="secondary"
        fullWidth
        leftIcon={<FolderInput size={16} />}
        onClick={() => show({ kind: 'move', item })}
        disabled={busy}
      >
        {t('libraryFolders.move')}
      </Button>
    ),
  };
}
