/**
 * Jest setup for @trata/mobile.
 *
 * Mocks `react-native-reanimated` so animated components render synchronously.
 * Reanimated 4.x ships no jest helpers in its built `lib`, and its UI-thread
 * worklet runtime isn't available under jest. Our tests assert React-state-driven
 * observable behavior (a11y states, callbacks, element presence) - never
 * animation frame values - so a synchronous JS mock is sufficient and faithful.
 */
jest.mock("expo-crypto", () => ({
  // The native randomUUID is unavailable under jest; Node's crypto provides
  // real UUID v4 so repository/outbox tests see production-shaped ids.
  randomUUID: () => require("node:crypto").randomUUID(),
}))

jest.mock("@expo/vector-icons", () => {
  const React = require("react")
  const { Text } = require("react-native")
  // Synchronous stub so the default FAB glyph doesn't kick off async font
  // loading (which warns about setState outside `act` in RNTL).
  const Stub = React.forwardRef((props, ref) =>
    React.createElement(Text, { ref }, props.name ? `icon:${props.name}` : "icon"),
  )
  Stub.displayName = "VectorIcon"
  return {
    __esModule: true,
    Ionicons: Stub,
    createIconSet: () => Stub,
  }
})

// Under jest there is no compiled CSS, so Uniwind's withUniwind HOC cannot
// resolve `accent-*` classes to colors and warns about it. Tests never assert
// resolved colors (className stays a plain ignored prop), so make the HOC an
// identity pass-through and keep the rest of the real module.
jest.mock("uniwind", () => ({
  ...jest.requireActual("uniwind"),
  withUniwind: (Component) => Component,
}))

jest.mock("react-native-reanimated", () => {
  const React = require("react")
  const { View } = require("react-native")

  const Animated = {
    View,
    createAnimatedComponent: (Component) => Component,
    // Called at module init by @gorhom/bottom-sheet; no-ops under jest.
    addWhitelistedUIProps: () => {},
    addWhitelistedNativeProps: () => {},
  }

  const useSharedValue = (initial) => ({
    value: typeof initial === "function" ? initial() : initial,
  })
  const useDerivedValue = (fn) => ({ value: fn() })
  const useReducedMotion = () => false
  // Execute the worklet once on the JS thread and return its style. Wrapped in
  // try/catch so a worklet-transform edge case never breaks a render.
  const useAnimatedStyle = (fn) => {
    try {
      return fn() || {}
    } catch {
      return {}
    }
  }
  const useAnimatedProps = () => ({})
  const useAnimatedReaction = () => {}
  // Scroll handlers are JS callbacks invoked on scroll events; hand the
  // handler back untouched so component logic that reads it stays exercisable.
  const useAnimatedScrollHandler = (handler) => handler
  // Worklet->JS calls run immediately: the "UI thread" is the JS thread here.
  const runOnJS = (fn) => fn

  // Animations resolve instantly to their target, including the completion
  // callback (fire-and-forget callers ignore it; settle-on-finish callers -
  // the period carousel's commit - complete synchronously).
  const withTiming = (toValue, _options, callback) => {
    if (typeof callback === "function") callback(true)
    return toValue
  }
  const withSpring = (toValue) => toValue
  const withDelay = (_delay, value) => value
  const withSequence = (...values) => values[values.length - 1]
  const withRepeat = (value) => value
  const withDecay = () => 0
  const cancelAnimation = () => {}

  const Extrapolation = { CLAMP: "clamp", IDENTITY: "identity", EXTEND: "extend" }
  const ReduceMotion = { System: "system", Always: "always", Never: "never" }
  const Easing = {
    bezier: () => () => 0,
    linear: () => () => 0,
    out: (fn) => fn,
    in: (fn) => fn,
    inOut: (fn) => fn,
  }

  const interpolate = (value, inputRange, outputRange) => {
    if (value <= inputRange[0]) return outputRange[0]
    if (value >= inputRange[inputRange.length - 1]) {
      return outputRange[outputRange.length - 1]
    }
    for (let i = 0; i < inputRange.length - 1; i++) {
      if (value >= inputRange[i] && value <= inputRange[i + 1]) {
        const t = (value - inputRange[i]) / (inputRange[i + 1] - inputRange[i])
        return outputRange[i] + (outputRange[i + 1] - outputRange[i]) * t
      }
    }
    return outputRange[0]
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

  // Layout animations (entering/exiting) run on the UI thread; under the
  // synchronous mock they render statically at their final position. The
  // builder chain (.duration/.springify/...) must stay callable.
  const makeLayoutAnimation = () => {
    const component = (props) => React.createElement(View, props)
    for (const builder of ["duration", "delay", "springify", "damping", "stiffness", "withCallback"]) {
      component[builder] = () => component
    }
    return component
  }

  return {
    __esModule: true,
    default: Animated,
    Animated,
    SlideInLeft: makeLayoutAnimation(),
    SlideInRight: makeLayoutAnimation(),
    SlideOutLeft: makeLayoutAnimation(),
    SlideOutRight: makeLayoutAnimation(),
    useSharedValue,
    useDerivedValue,
    useReducedMotion,
    useAnimatedStyle,
    useAnimatedProps,
    useAnimatedReaction,
    useAnimatedScrollHandler,
    runOnJS,
    withTiming,
    withSpring,
    withDelay,
    withSequence,
    withRepeat,
    withDecay,
    cancelAnimation,
    Extrapolation,
    ReduceMotion,
    Easing,
    interpolate,
    clamp,
  }
})

// expo-blur's native blur view is unavailable under jest; tests never assert
// resolved visuals, so a plain View passthrough (dropping blur-only props,
// renamed to "_" so oxlint accepts the intentional discards) is sufficient
// and faithful.
jest.mock("expo-blur", () => {
  const React = require("react")
  const { View } = require("react-native")
  const BlurView = ({
    intensity: _intensity,
    tint: _tint,
    experimentalBlurMethod: _experimentalBlurMethod,
    ...rest
  }) => React.createElement(View, rest)
  return { __esModule: true, BlurView }
})

// react-native-gesture-handler's GestureDetector drives gestures through
// the reanimated worklet runtime, which the synchronous reanimated mock
// above cannot host (Reanimated.useEvent is unavailable, so any detector
// render crashes). Tests never assert gesture mechanics (taps/swipes are
// e2e-only, per AGENTS.md), so the detector becomes a passthrough and the
// Gesture builders inert chainable stubs; everything else stays real.
jest.mock("react-native-gesture-handler", () => {
  const React = require("react")
  const actual = jest.requireActual("react-native-gesture-handler")
  const chainable = () => {
    const stub = {}
    const methods = [
      "activeOffsetX",
      "failOffsetY",
      "runOnJS",
      "enabled",
      "onBegin",
      "onStart",
      "onUpdate",
      "onEnd",
      "onFinalize",
      "simultaneousWithExternalGesture",
      "requireExternalGestureToFail",
      "withTestId",
    ]
    for (const method of methods) stub[method] = () => stub
    return stub
  }
  return {
    ...actual,
    GestureDetector: ({ children }) => React.createElement(React.Fragment, null, children),
    Gesture: { ...actual.Gesture, Tap: chainable, Pan: chainable },
  }
})

// @shopify/react-native-skia draws through its own native GPU pipeline, which
// is unavailable under jest. Tests never assert pixels or resolved styles -
// a chart's data is asserted via testIDs/labels on the surrounding RN nodes -
// so a Canvas that renders its children plus inert drawables is sufficient
// and faithful (the real renderer is exercised by the Maestro e2e suite).
jest.mock("@shopify/react-native-skia", () => {
  const React = require("react")
  const { View } = require("react-native")
  const Canvas = ({ children, ...rest }) => React.createElement(View, rest, children)
  // Drawables carry no RN-renderable content; render nothing under jest.
  const Path = () => null
  const pathStub = { addArc: () => pathStub }
  const Skia = {
    Path: { Make: () => pathStub },
    XYWHRect: (x, y, width, height) => ({ x, y, width, height }),
  }
  return { __esModule: true, Canvas, Path, Skia }
})

// @gorhom/bottom-sheet renders via reanimated animations and portals, which
// never run under the hand-rolled reanimated mock above (its animation
// callbacks are no-ops, so a presented sheet's content never mounts).
// Stub the library with Modal-semantics equivalents: present/close on the
// ref, children render while presented, the custom backdrop renders behind,
// and footerComponent (a ComponentType) renders after the children like the
// real BottomSheetContent does. The real library is exercised by the Maestro
// e2e suite; prop correctness is enforced by the TypeScript types.
jest.mock("@gorhom/bottom-sheet", () => {
  const React = require("react")
  const { Modal, TextInput, View } = require("react-native")

  const BottomSheetModal = React.forwardRef(function BottomSheetModal(
    { children, backdropComponent, footerComponent, onDismiss },
    ref,
  ) {
    const [presented, setPresented] = React.useState(false)
    React.useImperativeHandle(ref, () => ({
      present: () => setPresented(true),
      close: () => setPresented(false),
      dismiss: () => setPresented(false),
    }))
    if (!presented) return null
    const Backdrop = backdropComponent
    const Footer = footerComponent
    return (
      <Modal visible transparent animationType="none" onRequestClose={onDismiss}>
        {Backdrop ? <Backdrop /> : null}
        <View>
          {children}
          {Footer ? <Footer /> : null}
        </View>
      </Modal>
    )
  })

  const BottomSheetView = ({ children, ...rest }) => <View {...rest}>{children}</View>
  const BottomSheetScrollView = ({ children, ...rest }) => <View {...rest}>{children}</View>
  // The real footer pins itself via animatedFooterPosition; a plain View is
  // enough under jest (content and testIDs still render).
  const BottomSheetFooter = ({ children, ...rest }) => <View {...rest}>{children}</View>
  // The sheet-aware input is a plain TextInput under jest; what matters for
  // tests is that BottomSheetInput renders a real focusable/changeable input.
  const BottomSheetTextInput = TextInput

  return {
    __esModule: true,
    BottomSheetModal,
    BottomSheetView,
    BottomSheetScrollView,
    BottomSheetFooter,
    BottomSheetTextInput,
    BottomSheetModalProvider: ({ children }) => children,
    BottomSheetBackdrop: View,
  }
})
