// RU error messages for the shared repository error model. Mobile has no
// react-i18next wiring yet (AGENTS.md: i18n is a pending concern), so these
// mirror the wording of the shared @trata/i18n RU bundle as a
// static map - the web app's repository-i18n.ts is the twin of this file.
// When mobile i18n lands, this module becomes a thin t() adapter.

import {
  getRepositoryErrorMessage,
  RepositoryError,
  type RepositoryErrorMessages,
} from '@trata/api'

const REPOSITORY_ERRORS_RU: RepositoryErrorMessages = {
  notFound: 'Не найдено',
  hasReferences: 'Невозможно удалить, так как есть связанные транзакции',
  invalidPayload: 'Некорректные данные',
  unknownReferences: 'Указан неизвестный счёт или категория',
  versionConflict: 'Изменено другим действием. Обновите и повторите',
  alreadyExists: 'Уже существует',
  unauthorized: 'Необходимо войти',
  rateLimited: 'Слишком много попыток. Попробуйте позже',
  conflict: 'Действие конфликтует с текущим состоянием',
  generic: 'Что-то пошло не так',
}

// Backend apiCodes whose wording the coarse codes cannot distinguish
// (household-join lifecycle errors). Checked before the coarse map - the
// machine code is the exact backend verdict (e.g. 403 EMAIL_MISMATCH vs the
// lifecycle 404s all read "not found" through the coarse codes).
const API_CODE_ERRORS_RU: Record<string, string> = {
  HOUSEHOLD_INVITATION_EMAIL_MISMATCH: 'Приглашение отправлено на другой адрес',
  HOUSEHOLD_INVITATION_EXPIRED: 'Срок действия приглашения истёк',
  HOUSEHOLD_INVITATION_REVOKED: 'Приглашение отменено владельцем',
  HOUSEHOLD_INVITATION_ALREADY_ACCEPTED: 'Приглашение уже принято',
  HOUSEHOLD_INVITATION_NOT_FOUND: 'Приглашение не найдено',
  HOUSEHOLD_CODE_INVALID: 'Неверный код домохозяйства',
  HOUSEHOLD_OWNER_WITH_MEMBERS: 'Владелец не может покинуть домохозяйство с участниками',
  CATEGORY_ARCHIVED: 'Категория в архиве и недоступна для новых транзакций',
  PLANNED_PAYMENT_CATEGORY_ARCHIVED: 'Категория в архиве и недоступна для плановых платежей',
}

/** Human-readable RU message for any repository error (code-keyed). */
export function getRepositoryErrorText(error: unknown): string {
  if (error instanceof RepositoryError && error.apiCode) {
    const specific = API_CODE_ERRORS_RU[error.apiCode]
    if (specific) return specific
  }
  return getRepositoryErrorMessage(error, REPOSITORY_ERRORS_RU)
}
