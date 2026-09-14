import z from 'zod'
import i18n from '@/shared/i18n'

export interface TransferEditValues {
  type: 'transfer'
  fromAccountId: string
  toAccountId: string
  amount: number
  /**
   * The destination-account credit in majors. Required exactly when the two
   * accounts' currencies differ - the iff-rule below, validated against the
   * effective accounts and re-validated by the backend.
   */
  destinationAmount?: number
  description?: string
}

export interface TransferSchemaContext {
  /**
   * Whether the effective account pair spans two currencies - read at parse
   * time over the form's reactive account state (multi-currency iff-rule).
   */
  isCrossCurrency: () => boolean
}

export const createTransferEditSchema = ({ isCrossCurrency }: TransferSchemaContext) => {
  const { t } = i18n.global
  const destinationAmountMessage = t('validation.mustBePositive', {
    field: t('addTransfer.destinationAmountLabel'),
  })

  return (
    z
      .object({
        type: z.literal('transfer', {
          message: t('validation.select', { field: t('fields.transactionType') }),
        }),
        fromAccountId: z
          .string({ error: t('validation.select', { field: t('fields.fromAccount') }) })
          .min(1, t('validation.select', { field: t('fields.fromAccount') })),
        toAccountId: z
          .string({ error: t('validation.select', { field: t('fields.toAccount') }) })
          .min(1, t('validation.select', { field: t('fields.toAccount') })),
        amount: z
          .number({ error: t('validation.enter', { field: t('fields.amount') }) })
          .positive(t('validation.mustBePositive', { field: t('fields.amount') })),
        destinationAmount: z
          .number({
            error: t('validation.enter', { field: t('addTransfer.destinationAmountLabel') }),
          })
          .positive(destinationAmountMessage)
          .optional(),
        description: z
          .string({ error: t('validation.mustBeString', { field: t('fields.description') }) })
          .optional(),
      })
      .refine((data) => data.fromAccountId !== data.toAccountId, {
        path: ['toAccountId'],
        message: t('validation.transferAccountsMustDiffer'),
      })
      // The iff-rule's required leg: a cross-currency transfer must carry the
      // destination credit; a same-currency one must not.
      .superRefine((data, ctx) => {
        if (isCrossCurrency() && data.destinationAmount === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['destinationAmount'],
            message: destinationAmountMessage,
          })
        }
      })
  )
}
