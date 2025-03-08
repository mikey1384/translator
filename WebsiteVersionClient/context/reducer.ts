import { User } from '~/types';

export default function ManagementReducer(
  state: any,
  action: {
    type: string;
    [key: string]: any;
  }
) {
  switch (action.type) {
    case 'ADD_ACCOUNT_TYPE':
      return {
        ...state,
        accountTypes: state.accountTypes.concat(action.accountType)
      };
    case 'ADD_ADMIN_LOG':
      return {
        ...state,
        adminLogs: state.adminLogs.concat(action.adminLog)
      };
    case 'CLEAR_ADMIN_LOGS':
      return {
        ...state,
        adminLogs: []
      };
    case 'APPROVE_REQUEST':
      return {
        ...state,
        approvalItems: state.approvalItems.map(
          (approvalItem: {
            id: number;
            status: string;
            type: string;
            submittedBy: number;
          }) =>
            approvalItem.type === action.requestType &&
            approvalItem.submittedBy === action.userId
              ? {
                  ...approvalItem,
                  status: action.status
                }
              : approvalItem
        )
      };
    case 'EDIT_MODERATORS':
      return {
        ...state,
        moderators: action.newModerators.concat(
          state.moderators.filter(
            (moderator: User) =>
              !action.newModerators
                .map((newModerator: User) => newModerator.id)
                .includes(moderator.id)
          )
        )
      };
    case 'FILTER_MODERATORS':
      return {
        ...state,
        moderators: state.moderators.filter(
          (moderator: User) => moderator.id !== action.userId
        )
      };
    case 'CHANGE_MODERATOR_ACCOUNT_TYPE':
      return {
        ...state,
        moderators: action.selectedAccountType
          ? state.moderators.map((moderator: User) =>
              moderator.id === action.userId
                ? {
                    ...moderator,
                    userType: action.selectedAccountType
                  }
                : moderator
            )
          : state.moderators.filter(
              (moderator: User) => moderator.id !== action.userId
            )
      };
    case 'DELETE_ACCOUNT_TYPE':
      return {
        ...state,
        accountTypes: state.accountTypes.filter(
          (accountType: { label: string }) =>
            accountType.label !== action.accountTypeLabel
        ),
        moderators: state.moderators.filter(
          (moderator: User) => moderator.userType !== action.accountTypeLabel
        )
      };
    case 'EDIT_ACCOUNT_TYPE':
      return {
        ...state,
        accountTypes: state.accountTypes.map((accountType: { label: string }) =>
          accountType.label === action.label
            ? {
                ...accountType,
                ...action.editedAccountType
              }
            : accountType
        ),
        moderators: state.moderators.map((moderator: User) => {
          return {
            ...moderator,
            userType:
              moderator.userType === action.label
                ? action.editedAccountType.label
                : moderator.userType
          };
        })
      };
    case 'LOAD_ACCOUNT_TYPES':
      return {
        ...state,
        accountTypes: action.accountTypes,
        accountTypesLoaded: true
      };
    case 'LOAD_APPROVAL_ITEMS':
      return {
        ...state,
        approvalItems: action.approvalItems,
        approvalItemsLoaded: true
      };
    case 'LOAD_MORE_APPROVAL_ITEMS':
      return {
        ...state,
        numApprovalItemsShown: state.numApprovalItemsShown + 10
      };
    case 'LOAD_BANNED_USERS':
      return {
        ...state,
        bannedUsers: action.bannedUsers,
        bannedUsersLoaded: true
      };
    case 'LOAD_MANAGEMENT':
      return {
        ...state,
        loaded: true
      };
    case 'LOAD_WEALTH_DATA':
      return {
        ...state,
        wealthData: action.wealthData,
        wealthDataLoaded: true
      };
    case 'LOAD_MODERATORS':
      return {
        ...state,
        moderators: action.moderators,
        moderatorsLoaded: true
      };
    case 'LOAD_MORE_MODERATORS':
      return {
        ...state,
        numModeratorsShown: state.numModeratorsShown + 10
      };
    case 'LOAD_SUPERMODS':
      return {
        ...state,
        supermods: action.supermods,
        supermodsLoaded: true
      };
    case 'LOAD_MORE_SUPERMODS':
      return {
        ...state,
        numSupermodsShown: state.numSupermodsShown + 10
      };
    case 'EDIT_SUPERMODS':
      return {
        ...state,
        supermods: action.supermods.concat(
          state.supermods.filter(
            (supermod: User) =>
              !action.supermods
                .map((supermod: User) => supermod.id)
                .includes(supermod.id)
          )
        )
      };
    case 'REMOVE_SUPERMOD':
      return {
        ...state,
        supermods: state.supermods.filter(
          (supermod: User) => supermod.id !== action.userId
        )
      };
    case 'SET_SUPERMOD_STATE':
      return {
        ...state,
        supermods: state.supermods.map((supermod: User) =>
          supermod.id === action.userId
            ? {
                ...supermod,
                ...action.newState
              }
            : supermod
        )
      };
    case 'UPDATE_BAN_STATUS':
      return {
        ...state,
        bannedUsers: [action.user].concat(
          state.bannedUsers.filter(
            (user: { id: number }) => user.id !== action.user.id
          )
        )
      };
    case 'SET_IS_TRANSLATION_IN_PROGRESS':
      return {
        ...state,
        isTranslationInProgress: action.isTranslationInProgress
      };
    case 'SET_IS_MERGING_IN_PROGRESS':
      return {
        ...state,
        isMergingInProgress: action.isMergingInProgress
      };
    case 'SET_SUBTITLE_TRANSLATION_PROGRESS':
      return {
        ...state,
        subtitleTranslationProgress: {
          progress: action.progress,
          stage: action.stage,
          current: action.current,
          total: action.total,
          error: action.error,
          warning: action.warning
        }
      };
    case 'SET_SUBTITLE_MERGE_PROGRESS':
      return {
        ...state,
        subtitleMergeProgress: {
          progress: action.progress,
          stage: action.stage,
          error: action.error
        }
      };
    case 'SET_VIDEO_FILE':
      return {
        ...state,
        videoFile: action.videoFile
      };
    case 'SET_VIDEO_URL':
      return {
        ...state,
        videoUrl: action.videoUrl
      };
    default:
      return state;
  }
}
