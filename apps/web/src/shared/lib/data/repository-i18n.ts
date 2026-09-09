import i18n from '@/shared/i18n'
import type { RepositoryErrorMessages } from '@trata/api'

export const getRepositoryErrorMessages = (): RepositoryErrorMessages => ({
  notFound: i18n.global.t('errors.notFound'),
  hasReferences: i18n.global.t('errors.hasReferences'),
  invalidPayload: i18n.global.t('errors.invalidPayload'),
  unknownReferences: i18n.global.t('errors.unknownReferences'),
  versionConflict: i18n.global.t('errors.versionConflict'),
  alreadyExists: i18n.global.t('errors.alreadyExists'),
  unauthorized: i18n.global.t('errors.unauthorized'),
  rateLimited: i18n.global.t('errors.rateLimited'),
  conflict: i18n.global.t('errors.conflict'),
  generic: i18n.global.t('errors.generic'),
})
