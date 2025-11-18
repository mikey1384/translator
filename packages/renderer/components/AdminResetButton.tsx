import { css } from '@emotion/css';
import { useState, useEffect } from 'react';
import { useCreditStore } from '../state';
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

export default function AdminResetButton() {
  const { refresh } = useCreditStore();
  const [isAdmin, setIsAdmin] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    // Check if current device is admin device
    const checkAdminStatus = async () => {
      try {
        const [deviceId, adminDeviceId] = await Promise.all([
          SystemIPC.getDeviceId(),
          SystemIPC.getAdminDeviceId(),
        ]);
        setIsAdmin(Boolean(adminDeviceId && deviceId === adminDeviceId));
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
        alert(`Credit add failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Credit add error:', error);
      alert(`Credit add error: ${error}`);
    } finally {
      setAddLoading(false);
    }
  };

  const handleResetToZero = async () => {
    if (!isAdmin || resetLoading) return;

    // Confirm with user since this is destructive
    const confirmed = confirm(
      'Are you sure you want to reset credits to 0? This cannot be undone.'
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
        alert(`Credit reset to 0 failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Credit reset to 0 error:', error);
      alert(`Credit reset to 0 error: ${error}`);
    } finally {
      setResetLoading(false);
    }
  };

  // Only render for admin
  if (!isAdmin) return null;

  return (
    <div className={adminButtonContainer}>
      <button
        className={addButton}
        onClick={handleAddCredits}
        disabled={addLoading || resetLoading}
        title="Admin: Add standard pack (350,000 credits)"
      >
        {addLoading ? '🔄 Adding...' : '➕ Add 350k Credits'}
      </button>
      <button
        className={resetButton}
        onClick={handleResetToZero}
        disabled={addLoading || resetLoading}
        title="Admin: Reset credits to 0"
      >
        {resetLoading ? '🔄 Resetting...' : '🗑️ Reset to 0'}
      </button>
    </div>
  );
}
