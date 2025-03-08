import { Dispatch } from '~/types';

export default function ManagementActions(dispatch: Dispatch) {
  return {
    onAddAccountType(accountType: string) {
      return dispatch({
        type: 'ADD_ACCOUNT_TYPE',
        accountType
      });
    },
    onAddAdminLog(adminLog: object) {
      return dispatch({
        type: 'ADD_ADMIN_LOG',
        adminLog
      });
    },
    onClearAdminLogs() {
      return dispatch({
        type: 'CLEAR_ADMIN_LOGS'
      });
    },
    onApproveRequest({
      status,
      userId,
      requestType
    }: {
      status: string;
      userId: number;
      requestType: string;
    }) {
      return dispatch({
        type: 'APPROVE_REQUEST',
        status,
        userId,
        requestType
      });
    },
    onDeleteAccountType(accountTypeLabel: string) {
      return dispatch({
        type: 'DELETE_ACCOUNT_TYPE',
        accountTypeLabel
      });
    },
    onEditModerators(newModerators: object[]) {
      return dispatch({
        type: 'EDIT_MODERATORS',
        newModerators
      });
    },
    onEditSupermods(supermods: object[]) {
      return dispatch({
        type: 'EDIT_SUPERMODS',
        supermods
      });
    },
    onFilterModerators(userId: number) {
      return dispatch({
        type: 'FILTER_MODERATORS',
        userId
      });
    },
    onChangeModeratorAccountType({
      userId,
      selectedAccountType
    }: {
      userId: number;
      selectedAccountType: string;
    }) {
      return dispatch({
        type: 'CHANGE_MODERATOR_ACCOUNT_TYPE',
        userId,
        selectedAccountType
      });
    },
    onEditAccountType({
      label,
      editedAccountType
    }: {
      label: string;
      editedAccountType: string;
    }) {
      return dispatch({
        type: 'EDIT_ACCOUNT_TYPE',
        label,
        editedAccountType
      });
    },
    onLoadAccountTypes(accountTypes: string[]) {
      return dispatch({
        type: 'LOAD_ACCOUNT_TYPES',
        accountTypes
      });
    },
    onLoadApprovalItems(approvalItems: object[]) {
      return dispatch({
        type: 'LOAD_APPROVAL_ITEMS',
        approvalItems
      });
    },
    onLoadMoreApprovalItems() {
      return dispatch({
        type: 'LOAD_MORE_APPROVAL_ITEMS'
      });
    },
    onLoadBannedUsers(bannedUsers: object[]) {
      return dispatch({
        type: 'LOAD_BANNED_USERS',
        bannedUsers
      });
    },
    onLoadManagement() {
      return dispatch({
        type: 'LOAD_MANAGEMENT'
      });
    },
    onLoadWealthData(wealthData: object[]) {
      return dispatch({
        type: 'LOAD_WEALTH_DATA',
        wealthData
      });
    },
    onLoadModerators(moderators: object[]) {
      return dispatch({
        type: 'LOAD_MODERATORS',
        moderators
      });
    },
    onLoadMoreModerators() {
      return dispatch({
        type: 'LOAD_MORE_MODERATORS'
      });
    },
    onLoadSupermods(supermods: object[]) {
      return dispatch({
        type: 'LOAD_SUPERMODS',
        supermods
      });
    },
    onLoadMoreSupermods() {
      return dispatch({
        type: 'LOAD_MORE_SUPERMODS'
      });
    },
    onUpdateBanStatus(user: object) {
      return dispatch({
        type: 'UPDATE_BAN_STATUS',
        user
      });
    },
    onRemoveSupermod(userId: number) {
      return dispatch({
        type: 'REMOVE_SUPERMOD',
        userId
      });
    },
    onSetSupermodState({
      userId,
      newState
    }: {
      userId: number;
      newState: object;
    }) {
      return dispatch({
        type: 'SET_SUPERMOD_STATE',
        userId,
        newState
      });
    },
    onSetIsTranslationInProgress(isTranslationInProgress: boolean) {
      return dispatch({
        type: 'SET_IS_TRANSLATION_IN_PROGRESS',
        isTranslationInProgress
      });
    },
    onSetIsMergingInProgress(isMergingInProgress: boolean) {
      return dispatch({
        type: 'SET_IS_MERGING_IN_PROGRESS',
        isMergingInProgress
      });
    },
    onSetSubtitleTranslationProgress({
      progress,
      stage,
      current,
      total,
      error,
      warning
    }: {
      progress: number;
      stage: string;
      current?: number;
      total?: number;
      error?: string;
      warning?: string;
    }) {
      return dispatch({
        type: 'SET_SUBTITLE_TRANSLATION_PROGRESS',
        progress,
        stage,
        current,
        total,
        error,
        warning
      });
    },
    onSetSubtitleMergeProgress({
      progress,
      stage,
      error
    }: {
      progress: number;
      stage: string;
      error?: string;
    }) {
      return dispatch({
        type: 'SET_SUBTITLE_MERGE_PROGRESS',
        progress,
        stage,
        error
      });
    },
    onSetVideoFile(videoFile: File) {
      return dispatch({
        type: 'SET_VIDEO_FILE',
        videoFile
      });
    },
    onSetVideoUrl(videoUrl: string) {
      return dispatch({
        type: 'SET_VIDEO_URL',
        videoUrl
      });
    }
  };
}
