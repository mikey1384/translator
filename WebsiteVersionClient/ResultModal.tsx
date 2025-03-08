import React from 'react';

interface ModalAction {
  label: string;
  action: () => void;
  primary?: boolean;
}

interface ResultModalProps {
  modalTitle: string;
  modalContent: React.ReactNode;
  modalActions: ModalAction[];
  onClose: () => void;
}

export default function ResultModal({
  modalTitle,
  modalContent,
  modalActions,
  onClose
}: ResultModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1050,
        backdropFilter: 'blur(3px)'
      }}
      onClick={(e) => {
        // Close modal when clicking outside
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
          width: '80%',
          maxWidth: 800,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            padding: '15px 20px',
            borderBottom: '1px solid #eee',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <h3 style={{ margin: 0 }}>{modalTitle}</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: '#666'
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            padding: '20px',
            overflowY: 'auto',
            maxHeight: 'calc(80vh - 130px)'
          }}
        >
          {typeof modalTitle === 'string' &&
          modalTitle.includes('Split Complete') ? (
            <div>{modalContent}</div>
          ) : (
            <pre
              style={{
                maxHeight: '50vh',
                overflowY: 'auto',
                background: '#f7f7f7',
                border: '1px solid #ccc',
                padding: 10,
                borderRadius: 4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {modalContent}
            </pre>
          )}
        </div>
        <div
          style={{
            padding: '15px 20px',
            borderTop: '1px solid #eee',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10
          }}
        >
          {modalActions.map((action, index) => (
            <button
              key={index}
              onClick={action.action}
              style={{
                padding: '8px 16px',
                backgroundColor: action.primary ? '#007bff' : '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
