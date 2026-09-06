// The plan confirmation flow (planned-payments capability): a cross-entity
// interaction (plan + accounts + categories), which is why it lives at the
// features layer - the plans screen, the dashboard attention card, and the
// reminder deep link all open the same dialog.
export { default as ConfirmPlanDialog } from './ui/ConfirmPlanDialog.vue'
