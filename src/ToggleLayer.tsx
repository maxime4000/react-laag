import * as React from "react";
import { AnchorEnum, PreferedX, PreferedY, LayerSide } from "./types";
import Layer from "./Layer";

import useOutsideClick from "./useOutsideClick";
import useOnScroll from "./useOnScroll";
import useElementRef from "./useElementRef";
import useOnWindowResize from "./useOnWindowResize";
import useTrackElementResize from "./useTrackElementResize";
import useIsomorphicLayoutEffect from "./useIsomorphicLayoutEffect";

import findFirstRelativeParent from "./findFirstRelativeParent";
import findScrollContainers from "./findScrollContainers";
import compensateScrollbars from "./compensateScrollbars";

import {
  EMPTY_STYLE,
  isSet,
  shouldUpdateStyles,
  getWindowClientRect
} from "./util";

import getAbsoluteStyle, { getArrowStyle } from "./style";

import { POSSIBLE_ANCHORS } from "./anchor";

import {
  doesEntireLayerFitWithinScrollParents,
  isLayerCompletelyInvisible,
  getLayerSide
} from "./rect";

type RenderChildrenProps = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerRef: React.RefObject<any>;
  layerSide: LayerSide | null;
};

type Placement = {
  anchor: AnchorEnum;
  triggerOffset?: number;
  scrollOffset?: number;
  possibleAnchors?: AnchorEnum[];
  autoAdjust?: boolean;
  snapToAnchor?: boolean;
  preferX?: PreferedX;
  preferY?: PreferedY;
};

type DisappearType = "partial" | "full";

export type ResultingStyles = {
  layer: React.CSSProperties;
  arrow: React.CSSProperties;
  layerSide: LayerSide;
};

type RenderLayerProps = {
  layerProps: {
    ref: (element: HTMLElement | null) => void;
    style: React.CSSProperties;
  };
  arrowStyle: React.CSSProperties;
  layerSide: LayerSide;
  triggerRect: ClientRect | null;
  isOpen: boolean;
  close: () => void;
};

export type Props = {
  children: (childrenProps: RenderChildrenProps) => React.ReactNode;
  renderLayer: (props: RenderLayerProps) => React.ReactNode;
  isOpen?: boolean;
  placement: Placement;
  onStyle?: (
    layerStyle: React.CSSProperties,
    arrowStyle: React.CSSProperties,
    layerSide: LayerSide
  ) => void;
  closeOnOutsideClick?: boolean;
  onOutsideClick?: () => void;
  closeOnDisappear?: DisappearType;
  onDisappear?: (type: DisappearType) => void;
  ResizeObserver?: any;
  fixed?: boolean;
};

type UseTriggerElementState = {
  triggerElement: HTMLElement | null;
  relativeParentElement: HTMLElement | null;
  scrollParents: HTMLElement[];
};

function ToggleLayer({
  children,
  renderLayer,
  placement,
  onStyle,
  isOpen: isOpenExternal,
  closeOnOutsideClick,
  onOutsideClick,
  onDisappear,
  closeOnDisappear,
  fixed,
  ...props
}: Props) {
  /**
   * Tracks trigger element and keeps it in state together with it's
   * relative/absolute positioned parent
   */
  const [
    triggerRef,
    { relativeParentElement, triggerElement, scrollParents }
  ] = useElementRef<UseTriggerElementState>(
    { triggerElement: null, relativeParentElement: null, scrollParents: [] },
    React.useCallback((triggerElement: HTMLElement) => {
      const relativeParentElement =
        findFirstRelativeParent(triggerElement.parentElement) || document.body;

      if (relativeParentElement === document.body) {
        document.body.style.position = "relative";
      }

      return {
        triggerElement,
        relativeParentElement,
        scrollParents: findScrollContainers(triggerElement)
      };
    }, [])
  );

  const [INITIAL_STYLES] = React.useState<ResultingStyles>({
    layer: EMPTY_STYLE,
    arrow: EMPTY_STYLE,
    layerSide: placement.anchor.split("_")[0].toLowerCase() as LayerSide
  });

  const [styles, setStyles] = React.useState<ResultingStyles>(INITIAL_STYLES);
  const lastStyles = React.useRef<ResultingStyles>(styles);

  const layerRef = React.useRef<HTMLElement | null>(null);

  const [isOpenInternal, setOpenInternal] = React.useState(false);

  const isOpen = isSet(isOpenExternal) ? isOpenExternal! : isOpenInternal;

  const calculateNewLayerStyle = React.useCallback(() => {
    /**
     * A.
     * Calculate new layer positions
     */

    const triggerRect = triggerElement!.getBoundingClientRect();

    // sometimes ResizeObserver calls this function when all values in the
    // trigger ClientRect are 0. Return early in that case
    if (triggerRect.height === 0) {
      return;
    }

    if (!layerRef.current) {
      return;
    }

    // gather all scroll parents (including the window ClientRect)
    // in order to check for collisions
    const scrollParentRects = fixed
      ? [getWindowClientRect()]
      : [
          ...scrollParents.map(parent =>
            compensateScrollbars(
              parent.getBoundingClientRect(),
              parent.clientWidth,
              parent.clientHeight
            )
          ),
          getWindowClientRect()
        ];

    const options = {
      autoAdjust: placement.autoAdjust || false,
      snapToAnchor: placement.snapToAnchor || false,
      triggerOffset: placement.triggerOffset || 0,
      scrollOffset: placement.scrollOffset || 0,
      possibleAnchors: placement.possibleAnchors || POSSIBLE_ANCHORS,
      preferedAnchor: placement.anchor,
      preferedX: placement.preferX || "RIGHT",
      preferedY: placement.preferY || "BOTTOM",
      scrollLeft:
        relativeParentElement === document.body
          ? 0
          : relativeParentElement!.scrollLeft,
      scrollTop:
        relativeParentElement === document.body
          ? 0
          : relativeParentElement!.scrollTop,
      relativeParentElement
    };

    const layerBox = layerRef.current!.getBoundingClientRect();

    // construct layerRect
    const layer = {
      top: layerBox.top,
      left: layerBox.left,
      right: layerBox.right,
      bottom: layerBox.bottom,

      // use offsetWidth / offsetHeight in order the handle things like
      // scale-transforms
      width: layerRef.current!.offsetWidth,
      height: layerRef.current!.offsetHeight
    };

    const rects = {
      layer,
      relativeParent: relativeParentElement!.getBoundingClientRect(),
      scrollParents: scrollParentRects,
      trigger: triggerRect
    };

    const scrollbarWidth =
      rects.relativeParent.width - relativeParentElement!.clientWidth;
    const scrollbarHeight =
      rects.relativeParent.height - relativeParentElement!.clientHeight;

    const { layerRect, layerStyle } = getAbsoluteStyle({
      rects,
      scrollbarWidth,
      scrollbarHeight,
      ...options
    });

    if (fixed) {
      layerStyle.bottom = undefined;
      layerStyle.right = undefined;
      layerStyle.top = layerRect.top;
      layerStyle.left = layerRect.left;
    }

    // determine in which side to layer will be relative to
    // the trigger
    const layerSide = getLayerSide(layerRect, triggerRect);

    // get optional arrow positions
    const arrowStyle = getArrowStyle(layerRect, triggerRect, layerSide);

    const newStyles: ResultingStyles = {
      layer: layerStyle,
      arrow: arrowStyle,
      layerSide
    };

    // only update styles when necessary
    if (shouldUpdateStyles(lastStyles.current, newStyles)) {
      // is parent in control of styles? (onStyle)
      if (isSet(onStyle)) {
        lastStyles.current = newStyles;
        onStyle!(newStyles.layer, newStyles.arrow, layerSide);
      }
      // ... otherwise set styles internally
      else {
        setStyles(newStyles);
      }
    }

    /**
     * B.
     * Manage disappearance
     */

    const hasOnDisappear = isSet(onDisappear);
    const shouldCloseOnDisappear = closeOnDisappear && !isSet(isOpenExternal);

    // Should we respond to the layer's partial or full disappearance?
    // (trigger's disappearance when `fixed` props is set)
    if (hasOnDisappear || shouldCloseOnDisappear) {
      const allScrollParents = [
        ...scrollParents.map(parent => parent.getBoundingClientRect()),
        getWindowClientRect()
      ];

      const partial = !doesEntireLayerFitWithinScrollParents(
        fixed ? triggerRect : layerRect,
        allScrollParents
      );
      const full = isLayerCompletelyInvisible(
        fixed ? triggerRect : layerRect,
        allScrollParents
      );

      // if parent is interested in diseappearance...
      if (hasOnDisappear) {
        onDisappear!(full ? "full" : "partial");
      }
      // ... else close accordingly
      else {
        if (closeOnDisappear === "partial" && partial) {
          setOpenInternal(false);
        }
        if (closeOnDisappear === "full" && full) {
          setOpenInternal(false);
        }
      }
    }
  }, [
    relativeParentElement,
    isOpen,
    triggerElement,
    scrollParents,
    fixed,
    placement
  ]);

  // call `calculateNewLayerStyle` when the layer's / trigger's
  // height and / or width changes
  const resizeObserver = useTrackElementResize(
    props.ResizeObserver,
    layerRef,
    triggerElement,
    isOpen,
    calculateNewLayerStyle
  );

  // On every render, check a few things...
  useIsomorphicLayoutEffect(() => {
    /**
     * A.
     * Ignore when render is caused by internal style change
     */
    const styleIsSetInterally = !isSet(onStyle);
    const effectBecauseOfInternalStyleChange = styles !== lastStyles.current;

    if (effectBecauseOfInternalStyleChange && styleIsSetInterally) {
      lastStyles.current = styles;
      return;
    }

    // reset lastStyles-ref when closed
    if (!isOpen) {
      lastStyles.current = INITIAL_STYLES;
      return;
    }

    /**
     * B.
     * Prepare to calculate new layer style
     */

    // if (!triggerElement) {
    //   throw new Error("Please provide a valid ref to the trigger element");
    // } else if (!layerRef.current) {
    //   throw new Error("Please provide a valid ref to the layer element");
    // }

    calculateNewLayerStyle();
  });

  // calculate new layer style when window size changes
  useOnWindowResize(calculateNewLayerStyle, isOpen);

  // calculate new layer style when user scrolls
  useOnScroll(scrollParents, calculateNewLayerStyle, isOpen);

  // handle clicks that are not originated from the trigger / layer
  // element
  useOutsideClick(
    [{ current: triggerElement }, layerRef],
    React.useCallback(() => {
      if (!isOpen) {
        return;
      }

      if (onOutsideClick) {
        onOutsideClick();
      }

      if (closeOnOutsideClick && !isSet(isOpenExternal)) {
        setOpenInternal(false);
      }
    }, [isOpen, setOpenInternal, isOpenExternal])
  );

  return (
    <>
      <>
        {children({
          isOpen,
          close: () => {
            /* istanbul ignore next */
            if (isSet(isOpenExternal)) {
              throw new Error(
                "You cannot call `close()` while using the `isOpen` prop"
              );
            }
            /* istanbul ignore next */
            setOpenInternal(false);
          },
          open: () => {
            /* istanbul ignore next */
            if (isSet(isOpenExternal)) {
              throw new Error(
                "You cannot call `open()` while using the `isOpen` prop"
              );
            }
            /* istanbul ignore next */
            setOpenInternal(true);
          },
          toggle: () => {
            /* istanbul ignore next */
            if (isSet(isOpenExternal)) {
              throw new Error(
                "You cannot call `toggle()` while using the `isOpen` prop"
              );
            }
            setOpenInternal(!isOpenInternal);
          },
          triggerRef,
          layerSide: isOpen ? styles.layerSide : null
        })}

        {relativeParentElement && (
          <Layer parentElement={relativeParentElement}>
            {renderLayer({
              layerProps: {
                ref: element => {
                  if (element) {
                    // observe the layer for resizing
                    // it's ok to observe the same element multiple times
                    // since multiple observes of same element are ignored
                    resizeObserver.observe(element!);
                  }

                  layerRef.current = element;
                },
                style: {
                  ...(isSet(onStyle) ? EMPTY_STYLE : styles.layer),
                  position: fixed ? "fixed" : "absolute",
                  willChange: "top, bottom, left, right"
                }
              },
              arrowStyle: {
                ...(isSet(onStyle) ? EMPTY_STYLE : styles.arrow),
                position: "absolute",
                willChange: "top, bottom, left, right"
              },
              isOpen,
              layerSide: styles.layerSide,
              triggerRect: triggerElement
                ? triggerElement.getBoundingClientRect()
                : null,
              close: () => {
                /* istanbul ignore next */
                if (isSet(isOpenExternal)) {
                  throw new Error(
                    "You cannot call `close()` while using the `isOpen` prop"
                  );
                }
                /* istanbul ignore next */
                setOpenInternal(false);
              }
            })}
          </Layer>
        )}
      </>
    </>
  );
}

export default ToggleLayer;