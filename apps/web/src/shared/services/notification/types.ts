// Closed unions: a typo'd context fails type-check instead of silently
// landing in the error logs. Extending them is a one-line edit here.
type ErrorFeature =
  | 'account'
  | 'category'
  | 'transaction'
  | 'session'
  | 'household'
  | 'sync'
  | 'planned-payment'
  | 'debtor'
  | 'debt-operation'
  | 'debt'

export type ErrorAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'archive'
  | 'unarchive'
  | 'list'
  | 'login'
  | 'register'
  | 'password-reset'
  | 'invite'
  | 'join'
  | 'leave'
  | 'dissolve'
  | 'rename'
  | 'remove-member'
  | 'update-display-name'
  | 'generate-code'
  | 'revoke-code'
  | 'revoke'
  | 'resend-invitation'
  | 'revoke-invitation'
  | 'restore'
  | 'confirm'
  | 'apply-join-choice'
  | 'keep-local'
  | 'take-server'
  | 'dismiss'

export interface ErrorContext {
  feature?: ErrorFeature
  action?: ErrorAction
}

export interface MutationErrorOptions extends ErrorContext {
  title: string // уже переведённая строка (caller явно вызывает t('addAccount.error'))
}
