import { css } from '@emotion/css';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreditStore, useAiStore } from '../state';
import { colors } from '../styles';
import { SystemIPC } from '../ipc';

const adminButtonContainer = css`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const adminButton = css`
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background-color 0.2s;

  &:disabled {
    background: ${colors.grayDark};
    cursor: not-allowed;
  }
`;

const addButton = css`
  ${adminButton}
  background: ${colors.success};
  color: white;

  &:hover:not(:disabled) {
    background: #059669;
  }
`;

const resetButton = css`
  ${adminButton}
  background: ${colors.danger};
  color: white;

  &:hover:not(:disabled) {
    background: #dc2626;
  }
`;

const previewButton = css`
  ${adminButton}
  background: ${colors.warning};
  color: white;

  &:hover:not(:disabled) {
    background: #d97706;
  }
`;

const previewActiveButton = css`
  ${adminButton}
  background: ${colors.primary};
  color: white;

  &:hover:not(:disabled) {
    background: #2563eb;
  }
`;

export default function AdminResetButton() {
  const { t } = useTranslation();
  const refresh = useCreditStore(s => s.refresh);
  const adminByoPreviewMode = useAiStore(state => state.adminByoPreviewMode);
  const setAdminByoPreviewMode = useAiStore(
    state => state.setAdminByoPreviewMode
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        setIsAdmin(await SystemIPC.isAdminMode());
      } catch (error) {
        console.error('Failed to check admin status:', error);
      }
    };

    checkAdminStatus();
  }, []);

  const handleAddCredits = async () => {
    if (!isAdmin || addLoading) return;

    setAddLoading(true);
    try {
      const result = await SystemIPC.resetCredits();

      if (result.success) {
        console.log(
          `✅ Credits added successful: Added ${result.creditsAdded} credits`
        );
        // Refresh credit balance
        await refresh();
      } else {
        console.error('❌ Credit add failed:', result.error);
        alert(
          t('errors.adminCreditAddFailed', {
            defaultValue: 'Credit add failed: {{message}}',
            message: result.error || 'unknown',
          })
        );
      }
    } catch (error) {
      console.error('❌ Credit add error:', error);
      alert(
        t('errors.adminCreditAddError', {
          defaultValue: 'Credit add error: {{message}}',
          message: String(error),
        })
      );
    } finally {
      setAddLoading(false);
    }
  };

  const handleResetToZero = async () => {
    if (!isAdmin || resetLoading) return;

    // Confirm with user since this is destructive
    const confirmed = window.confirm(
      t(
        'admin.confirmResetCreditsToZero',
        'Are you sure you want to reset credits to 0? This cannot be undone.'
      )
    );
    if (!confirmed) return;

    setResetLoading(true);
    try {
      const result = await SystemIPC.resetCreditsToZero();

      if (result.success) {
        console.log('✅ Credits reset to 0 successful');
        // Refresh credit balance
        await refresh();
      } else {
        console.error('❌ Credit reset to 0 failed:', result.error);
        alert(
          t('errors.adminCreditResetFailed', {
            defaultValue: 'Credit reset to 0 failed: {{message}}',
            message: result.error || 'unknown',
          })
        );
      }
    } catch (error) {
      console.error('❌ Credit reset to 0 error:', error);
      alert(
        t('errors.adminCreditResetError', {
          defaultValue: 'Credit reset to 0 error: {{message}}',
          message: String(error),
        })
      );
    } finally {
      setResetLoading(false);
    }
  };

  const handleToggleByoPreview = () => {
    setAdminByoPreviewMode(!adminByoPreviewMode);
  };

  // Only render for admin
  if (!isAdmin) return null;

  return (
    <div className={adminButtonContainer}>
      <button
        className={addButton}
        onClick={handleAddCredits}
        disabled={addLoading || resetLoading}
        title={t(
          'admin.addStandardPackTitle',
          'Admin: Add standard pack (350,000 credits)'
        )}
      >
        {addLoading
          ? `🔄 ${t('admin.adding', 'Adding...')}`
          : `➕ ${t('admin.addCredits', 'Add 350k Credits')}`}
      </button>
      <button
        className={resetButton}
        onClick={handleResetToZero}
        disabled={addLoading || resetLoading}
        title={t('admin.resetCreditsToZeroTitle', 'Admin: Reset credits to 0')}
      >
        {resetLoading
          ? `🔄 ${t('admin.resetting', 'Resetting...')}`
          : `🗑️ ${t('admin.resetToZero', 'Reset to 0')}`}
      </button>
      <button
        className={adminByoPreviewMode ? previewActiveButton : previewButton}
        onClick={handleToggleByoPreview}
        title={t(
          'admin.toggleByoPreviewTitle',
          'Admin: Toggle BYO preview mode (see UI as if BYO not purchased)'
        )}
      >
        {adminByoPreviewMode
          ? `👁️ ${t('admin.byoPreviewOn', 'BYO Preview ON')}`
          : `👁️ ${t('admin.byoPreview', 'BYO Preview')}`}
      </button>
    </div>
  );
}
