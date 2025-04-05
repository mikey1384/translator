import React, { createContext, useContext, useReducer } from 'react';
import ManagementActions from './actions.js';
import { ManagementReducer, AppState } from './reducer.js';

// Initial state
export const initialManagementState: AppState = {
  videoFile: null,
  videoUrl: '',
  isTranslationInProgress: false,
  isMergingInProgress: false,
  subtitleTranslationProgress: {
    progress: 0,
    stage: '',
  },
  subtitleMergeProgress: {
    progress: 0,
    stage: '',
  },
};

// Create context with initial state and actions
type ManagementContextType = {
  state: AppState;
  actions: ReturnType<typeof ManagementActions>;
};

const ManagementContext = createContext<ManagementContextType | undefined>(
  undefined
);

// Context provider component
export function ManagementContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(
    ManagementReducer,
    initialManagementState
  );
  const actions = ManagementActions(dispatch);

  return (
    <ManagementContext.Provider value={{ state, actions }}>
      {children}
    </ManagementContext.Provider>
  );
}

// Custom hook to use the management context
export function useManagementContext<T>(
  selector: (context: ManagementContextType) => T
): T {
  const context = useContext(ManagementContext);

  if (!context) {
    throw new Error(
      'useManagementContext must be used within a ManagementContextProvider'
    );
  }

  return selector(context);
}
