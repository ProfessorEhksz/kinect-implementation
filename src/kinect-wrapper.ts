/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { EventEmitter } from "events";
import Kinect2 from "kinect2";

export interface Body {
  joints: Record<number, Joint>;
  leftHandState: number;
  rightHandState: number;
  tracked: boolean;
  trackingId: number;
}

export interface BodyFrame {
  bodies: Body[];
  floorClipPlane?: {
    w: number;
    x: number;
    y: number;
    z: number;
  };
  timestamp: number;
}

export interface BodyIndexFrame {
  data: Buffer;
  height: number;
  timestamp: number;
  width: number;
}

// Frame type definitions
export interface ColorFrame {
  data: Buffer;
  height: number;
  timestamp: number;
  width: number;
}

export interface DepthFrame {
  data: Buffer;
  height: number;
  maxReliableDistance: number;
  minReliableDistance: number;
  timestamp: number;
  width: number;
}

export interface GestureResults {
  handsRaised: {
    leftRaised: boolean;
    rightRaised: boolean;
  };
  handStates: {
    left: HandState;
    right: HandState;
  };
  isJumping: boolean;
}

export interface InfraredFrame {
  data: Buffer;
  height: number;
  timestamp: number;
  width: number;
}

export interface Joint {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  colorX: number;
  colorY: number;
  depthX: number;
  depthY: number;
  orientationW: number;
  orientationX: number;
  orientationY: number;
  orientationZ: number;
  trackingState: number;
  x: number;
}

export interface JointAngles {
  leftElbow?: number;
  leftHip?: number;
  leftKnee?: number;
  leftShoulder?: number;
  rightElbow?: number;
  rightHip?: number;
  rightKnee?: number;
  rightShoulder?: number;
}

export interface LongExposureInfraredFrame {
  data: Buffer;
  height: number;
  timestamp: number;
  width: number;
}

export interface MultiSourceFrame {
  body?: BodyFrame;
  bodyIndex?: BodyIndexFrame;
  color?: ColorFrame;
  depth?: DepthFrame;
  infrared?: InfraredFrame;
  longExposureInfrared?: LongExposureInfraredFrame;
  rawDepth?: RawDepthFrame;
  timestamp: number;
}

export interface MultiSourceOptions {
  frameTypes: number[];
  includeJointFloorData?: boolean;
}

export interface RawDepthFrame {
  data: Buffer;
  height: number;
  timestamp: number;
  width: number;
}

// Define a type-safe event system
export const EventTypes = {
  bodyFrame: "bodyFrame",
  bodyIndexFrame: "bodyIndexFrame",
  colorFrame: "colorFrame",
  depthFrame: "depthFrame",
  fpsUpdate: "fpsUpdate",
  infraredFrame: "infraredFrame",
  longExposureInfraredFrame: "longExposureInfraredFrame",
  multiSourceFrame: "multiSourceFrame",
  rawDepthFrame: "rawDepthFrame",
} as const;

export interface EventMap {
  [EventTypes.bodyFrame]: BodyFrame;
  [EventTypes.bodyIndexFrame]: BodyIndexFrame;
  [EventTypes.colorFrame]: ColorFrame;
  [EventTypes.depthFrame]: DepthFrame;
  [EventTypes.fpsUpdate]: Record<string, number>;
  [EventTypes.infraredFrame]: InfraredFrame;
  [EventTypes.longExposureInfraredFrame]: LongExposureInfraredFrame;
  [EventTypes.multiSourceFrame]: MultiSourceFrame;
  [EventTypes.rawDepthFrame]: RawDepthFrame;
}

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

interface HandPosition {
  bodyTimestamp: number;
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

type HandState = "closed" | "lasso" | "notTracked" | "open" | "unknown";

// Interface for tracking both hands
interface HandTracker {
  leftHand: HandTrackingState;
  rightHand: HandTrackingState;
}

// Interface for hand tracking state
interface HandTrackingState {
  lastSwipeTime: number;
  positions: HandPosition[];
}

// Configuration for swipe detection
interface SwipeConfig {
  cooldownPeriod: number;
  maxHorizontalChange: number;
  maxVerticalChange: number;
  minMovementDistance: number;
  trackingDuration: number;
  velocityThreshold: number;
}

// Define swipe result interface
interface SwipeResult {
  direction: "backward" | "down" | "forward" | "left" | "right" | "up";
  distance: number;
  velocity: number;
}

const SWIPE_CONFIG: SwipeConfig = {
  cooldownPeriod: 800, // Reduced from 1000ms to allow more frequent swipes
  maxHorizontalChange: 0.35, // Increased from 0.2 to be more tolerant of horizontal drift during vertical swipes
  maxVerticalChange: 0.35, // Increased from 0.2 to be more tolerant of vertical drift during horizontal swipes
  minMovementDistance: 0.15, // Reduced from 0.3 to require less movement to trigger a swipe
  trackingDuration: 700, // Increased from 500ms to give more time for completing the gesture
  velocityThreshold: 0.2, // Reduced from 0.8 to allow slower movements to count as swipes
};

interface Debug {
  debug?: boolean;
}

export class Kinect2Wrapper {
  private debug = false;
  private emitter = new EventEmitter();
  private fps: Record<string, number> = {};
  private fpsCounts: Record<string, number> = {};

  private fpsTimer: Record<string, number> = {};

  private handTracker: HandTracker = {
    leftHand: {
      lastSwipeTime: 0,
      positions: [],
    },
    rightHand: {
      lastSwipeTime: 0,
      positions: [],
    },
  };
  private initialized = false;
  private kinect: Kinect2;

  private latestFrames: {
    body?: BodyFrame;
    bodyIndex?: BodyIndexFrame;
    color?: ColorFrame;
    depth?: DepthFrame;
    infrared?: InfraredFrame;
    longExposureInfrared?: LongExposureInfraredFrame;
    multiSource?: MultiSourceFrame;
    rawDepth?: RawDepthFrame;
  } = {};
  private swipeConfig: SwipeConfig = SWIPE_CONFIG;

  private tracking: {
    body: boolean;
    bodyIndex: boolean;
    color: boolean;
    depth: boolean;
    infrared: boolean;
    longExposureInfrared: boolean;
    multiSource: boolean;
    rawDepth: boolean;
  } = {
    body: false,
    bodyIndex: false,
    color: false,
    depth: false,
    infrared: false,
    longExposureInfrared: false,
    multiSource: false,
    rawDepth: false,
  };

  constructor(props: Debug & SwipeConfig = SWIPE_CONFIG) {
    const { debug, ...swipeConfig } = props;
    this.kinect = new Kinect2();
    this.debug = debug ?? false;
    this.swipeConfig = swipeConfig;
  }

  /**
   * Calculate angles for major joints
   * @param body Body to analyze
   * @returns Object with calculated joint angles
   */
  calculateJointAngles(body: Body): JointAngles {
    const result: JointAngles = {};

    const shoulderLeft = body.joints[Kinect2.JointType.shoulderLeft];
    const elbowLeft = body.joints[Kinect2.JointType.elbowLeft];
    const wristLeft = body.joints[Kinect2.JointType.wristLeft];

    const shoulderRight = body.joints[Kinect2.JointType.shoulderRight];
    const elbowRight = body.joints[Kinect2.JointType.elbowRight];
    const wristRight = body.joints[Kinect2.JointType.wristRight];

    const hipLeft = body.joints[Kinect2.JointType.hipLeft];
    const kneeLeft = body.joints[Kinect2.JointType.kneeLeft];
    const ankleLeft = body.joints[Kinect2.JointType.ankleLeft];

    const hipRight = body.joints[Kinect2.JointType.hipRight];
    const kneeRight = body.joints[Kinect2.JointType.kneeRight];
    const ankleRight = body.joints[Kinect2.JointType.ankleRight];

    if (shoulderLeft && elbowLeft && wristLeft && shoulderLeft.trackingState > 0 && elbowLeft.trackingState > 0 && wristLeft.trackingState > 0) {
      result.leftElbow = this.calculateAngle(shoulderLeft, elbowLeft, wristLeft);
    }

    if (
      shoulderRight &&
      elbowRight &&
      wristRight &&
      shoulderRight.trackingState > 0 &&
      elbowRight.trackingState > 0 &&
      wristRight.trackingState > 0
    ) {
      result.rightElbow = this.calculateAngle(shoulderRight, elbowRight, wristRight);
    }

    if (hipLeft && kneeLeft && ankleLeft && hipLeft.trackingState > 0 && kneeLeft.trackingState > 0 && ankleLeft.trackingState > 0) {
      result.leftKnee = this.calculateAngle(hipLeft, kneeLeft, ankleLeft);
    }

    if (hipRight && kneeRight && ankleRight && hipRight.trackingState > 0 && kneeRight.trackingState > 0 && ankleRight.trackingState > 0) {
      result.rightKnee = this.calculateAngle(hipRight, kneeRight, ankleRight);
    }

    return result;
  }

  /**
   * Close the Kinect sensor and all readers
   */
  /**
   * Close the Kinect sensor and all readers
   */
  close(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.initialized) {
        resolve(true);
        return;
      }

      const closePromises: Promise<unknown>[] = [];

      if (this.tracking.multiSource) {
        closePromises.push(this.closeMultiSourceReader());
      }

      if (this.tracking.color) {
        closePromises.push(this.closeColorReader());
      }

      if (this.tracking.depth) {
        closePromises.push(this.closeDepthReader());
      }

      if (this.tracking.infrared) {
        closePromises.push(this.closeInfraredReader());
      }

      if (this.tracking.longExposureInfrared) {
        closePromises.push(this.closeLongExposureInfraredReader());
      }

      if (this.tracking.rawDepth) {
        closePromises.push(this.closeRawDepthReader());
      }

      if (this.tracking.body) {
        closePromises.push(this.closeBodyReader());
      }

      if (this.tracking.bodyIndex) {
        closePromises.push(this.closeBodyIndexReader());
      }

      Promise.all(closePromises)
        .then(() => {
          this.kinect.close((err, result) => {
            if (err) {
              reject(err);
              return;
            }

            this.initialized = false;
            resolve(result);
          });
        })
        .catch((error: unknown) => {
          reject(error as Error);
        });
    });
  }

  /**
   * Close the body index reader
   */
  closeBodyIndexReader(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.tracking.bodyIndex) {
        resolve(true);
        return;
      }

      try {
        this.tracking.bodyIndex = false;
        delete this.latestFrames.bodyIndex;
        delete this.fpsCounts.bodyIndex;
        delete this.fpsTimer.bodyIndex;
        delete this.fps.bodyIndex;

        resolve(true);
      } catch (error) {
        if (error instanceof Error) {
          reject(error);
        }
      }
    });
  }
  /**
   * Close the body reader
   */
  closeBodyReader(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.tracking.body) {
        resolve(true);
        return;
      }

      this.kinect.closeBodyReader((err, result) => {
        if (err) {
          reject(err);
          return;
        }

        this.tracking.body = false;
        delete this.latestFrames.body;
        delete this.fpsCounts.body;
        delete this.fpsTimer.body;
        delete this.fps.body;

        resolve(result);
      });
    });
  }

  /**
   * Close the color reader
   */
  closeColorReader(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.tracking.color) {
        resolve(true);
        return;
      }

      this.kinect.closeColorReader((err, result) => {
        if (err) {
          reject(err);
          return;
        }

        this.tracking.color = false;
        delete this.latestFrames.color;
        delete this.fpsCounts.color;
        delete this.fpsTimer.color;
        delete this.fps.color;

        resolve(result);
      });
    });
  }

  /**
   * Close the depth reader
   */
  closeDepthReader(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.tracking.depth) {
        resolve(true);
        return;
      }

      this.kinect.closeDepthReader((err, result) => {
        if (err) {
          reject(err);
          return;
        }

        this.tracking.depth = false;
        delete this.latestFrames.depth;
        delete this.fpsCounts.depth;
        delete this.fpsTimer.depth;
        delete this.fps.depth;

        resolve(result);
      });
    });
  }

  /**
   * Close the infrared reader
   */
  closeInfraredReader(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.tracking.infrared) {
        resolve(true);
        return;
      }

      this.kinect.closeInfraredReader((err, result) => {
        if (err) {
          reject(err);
          return;
        }

        this.tracking.infrared = false;
        delete this.latestFrames.infrared;
        delete this.fpsCounts.infrared;
        delete this.fpsTimer.infrared;
        delete this.fps.infrared;

        resolve(result);
      });
    });
  }

  /**
   * Close the long exposure infrared reader
   */
  closeLongExposureInfraredReader(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.tracking.longExposureInfrared) {
        resolve(true);
        return;
      }

      this.kinect.closeLongExposureInfraredReader((err, result) => {
        if (err) {
          reject(err);
          return;
        }

        this.tracking.longExposureInfrared = false;
        delete this.latestFrames.longExposureInfrared;
        delete this.fpsCounts.longExposureInfrared;
        delete this.fpsTimer.longExposureInfrared;
        delete this.fps.longExposureInfrared;

        resolve(result);
      });
    });
  }

  /**
   * Close the multi-source reader
   */
  closeMultiSourceReader(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.tracking.multiSource) {
        resolve(true);
        return;
      }

      this.kinect.closeMultiSourceReader((err, result) => {
        if (err) {
          reject(err);
          return;
        }

        this.tracking.multiSource = false;
        delete this.latestFrames.multiSource;
        delete this.fpsCounts.multiSource;
        delete this.fpsTimer.multiSource;
        delete this.fps.multiSource;

        resolve(result);
      });
    });
  }

  /**
   * Close the raw depth reader
   */
  closeRawDepthReader(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.tracking.rawDepth) {
        resolve(true);
        return;
      }

      this.kinect.closeRawDepthReader((err, result) => {
        if (err) {
          reject(err);
          return;
        }

        this.tracking.rawDepth = false;
        delete this.latestFrames.rawDepth;
        delete this.fpsCounts.rawDepth;
        delete this.fpsTimer.rawDepth;
        delete this.fps.rawDepth;

        resolve(result);
      });
    });
  }

  detectGestures(body: Body): GestureResults {
    const result: GestureResults = {
      handsRaised: {
        leftRaised: false,
        rightRaised: false,
      },
      handStates: {
        left: this.handStateToString(body.leftHandState),
        right: this.handStateToString(body.rightHandState),
      },
      isJumping: false,
    };

    const head = body.joints[Kinect2.JointType.head];
    const handLeft = body.joints[Kinect2.JointType.handLeft];
    const handRight = body.joints[Kinect2.JointType.handRight];
    const shoulderLeft = body.joints[Kinect2.JointType.shoulderLeft];
    const shoulderRight = body.joints[Kinect2.JointType.shoulderRight];

    if (head && handLeft && shoulderLeft && head.trackingState > 0 && handLeft.trackingState > 0 && shoulderLeft.trackingState > 0) {
      result.handsRaised.leftRaised = handLeft.cameraY < shoulderLeft.cameraY && handLeft.cameraY >= head.cameraY - 0.1;
    }

    if (head && handRight && shoulderRight && head.trackingState > 0 && handRight.trackingState > 0 && shoulderRight.trackingState > 0) {
      result.handsRaised.rightRaised = handRight.cameraY < shoulderRight.cameraY && handRight.cameraY >= head.cameraY - 0.1;
    }

    const footLeft = body.joints[Kinect2.JointType.footLeft];
    const footRight = body.joints[Kinect2.JointType.footRight];
    const spineBase = body.joints[Kinect2.JointType.spineBase];

    if (footLeft && footRight && spineBase && footLeft.trackingState > 0 && footRight.trackingState > 0 && spineBase.trackingState > 0) {
      const avgFootHeight = (footLeft.cameraY + footRight.cameraY) / 2;
      const jumpThreshold = 0.1;
      result.isJumping = avgFootHeight > jumpThreshold;
    }

    return result;
  }

  detectSwipe(handPositions: HandPosition[]): null | SwipeResult {
    if (handPositions.length < 2) return null;

    const firstPosition = handPositions[0];
    const lastPosition = handPositions[handPositions.length - 1];

    const timeDiff = (lastPosition.timestamp - firstPosition.timestamp) / 1000;
    if (timeDiff === 0) return null;

    const xDiff = lastPosition.x - firstPosition.x;
    const yDiff = lastPosition.y - firstPosition.y;
    const zDiff = lastPosition.z - firstPosition.z;

    const distance = Math.sqrt(xDiff * xDiff + yDiff * yDiff + zDiff * zDiff);
    const velocity = distance / timeDiff;

    /* If movement is too slow, not a swipe */
    if (velocity < this.swipeConfig.velocityThreshold) return null;

    if (Math.abs(xDiff) > this.swipeConfig.minMovementDistance && Math.abs(yDiff) < this.swipeConfig.maxVerticalChange) {
      return {
        direction: xDiff > 0 ? "right" : "left",
        distance: Math.abs(xDiff),
        velocity,
      };
    }

    // Check vertical swipes (up/down)
    if (Math.abs(yDiff) > this.swipeConfig.minMovementDistance && Math.abs(xDiff) < this.swipeConfig.maxHorizontalChange) {
      return {
        direction: yDiff < 0 ? "up" : "down", // Y increases downward in Kinect space
        distance: Math.abs(yDiff),
        velocity,
      };
    }

    // Check forward/backward swipes
    if (
      Math.abs(zDiff) > this.swipeConfig.minMovementDistance &&
      Math.abs(xDiff) < this.swipeConfig.maxHorizontalChange &&
      Math.abs(yDiff) < this.swipeConfig.maxVerticalChange
    ) {
      return {
        direction: zDiff < 0 ? "forward" : "backward",
        distance: Math.abs(zDiff),
        velocity,
      };
    }

    return null;
  }
  /**
   * Find the nearest tracked person
   * @returns The nearest tracked person or undefined if no one is tracked
   */
  findNearestPerson(): Body | undefined {
    const bodyFrame = this.latestFrames.body;
    if (!bodyFrame) {
      return undefined;
    }

    let nearestPerson: Body | undefined;
    let minDistance = Infinity;

    bodyFrame.bodies.forEach((body) => {
      if (body.tracked) {
        // Get the spine base joint as reference for distance
        const spineBase = body.joints[Kinect2.JointType.spineBase];
        if (spineBase && spineBase.trackingState > 0) {
          const distance = spineBase.cameraZ;
          if (distance < minDistance) {
            minDistance = distance;
            nearestPerson = body;
          }
        }
      }
    });

    return nearestPerson;
  }

  /**
   * Get the latest frame of a specific type
   */
  getLatestFrame<K extends keyof typeof this.latestFrames>(frameType: K): (typeof this.latestFrames)[K] | undefined {
    return this.latestFrames[frameType];
  }

  /**
   * Get all tracked bodies
   * @returns Array of tracked bodies
   */
  getTrackedBodies(): Body[] {
    const bodyFrame = this.latestFrames.body;
    if (!bodyFrame) {
      return [];
    }

    return bodyFrame.bodies.filter((body) => body.tracked);
  }

  off<E extends EventType>(event: E, listener: (arg: EventMap[E]) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  // Type-safe event methods
  on<E extends EventType>(event: E, listener: (arg: EventMap[E]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  once<E extends EventType>(event: E, listener: (arg: EventMap[E]) => void): this {
    this.emitter.once(event, listener);
    return this;
  }

  /**
   * Open the Kinect sensor
   */
  open(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (this.initialized) {
        resolve(true);
        return;
      }

      const opened = this.kinect.open();
      if (!opened) {
        reject(new Error("Could not open Kinect sensor"));
        return;
      }

      this.initialized = true;
      resolve(true);
    });
  }

  removeAllListeners(event?: EventType): this {
    this.emitter.removeAllListeners(event);
    return this;
  }

  /**
   * Resets the hand positions for both left and right hands
   */
  resetHandPositions() {
    this.handTracker.leftHand.positions = [];
    this.handTracker.rightHand.positions = [];
  }

  /**
   * Start tracking body frames
   */
  trackBodies(): Promise<boolean> {
    if (this.tracking.body) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      if (!this.initialized) {
        reject(new Error("Kinect not initialized"));
        return;
      }

      const success = this.kinect.openBodyReader();
      if (!success) {
        reject(new Error("Failed to open body reader"));
        return;
      }

      this.tracking.body = true;
      this.fpsCounts.body = 0;
      this.fpsTimer.body = Date.now();
      this.fps.body = 0;

      this.kinect.on("bodyFrame", (frame: BodyFrame) => {
        // Update FPS counters
        this.fpsCounts.body++;
        const now = Date.now();
        const elapsed = now - this.fpsTimer.body;

        if (elapsed >= 1000) {
          this.fps.body = Math.round((this.fpsCounts.body * 1000) / elapsed);
          this.fpsTimer.body = now;
          this.fpsCounts.body = 0;

          // Emit FPS update
          this.emit(EventTypes.fpsUpdate, { ...this.fps });
        }

        // Store latest frame
        this.latestFrames.body = frame;

        // Emit body frame event
        this.emit(EventTypes.bodyFrame, frame);
      });

      resolve(true);
    });
  }

  /**
   * Start tracking body index frames
   */
  trackBodyIndex(): Promise<boolean> {
    if (this.tracking.bodyIndex) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      if (!this.initialized) {
        reject(new Error("Kinect not initialized"));
        return;
      }

      // Kinect2 SDK doesn't provide a direct method for body index frames
      // They are obtained through tracking specific body indices
      // For simplicity, we'll track all potential body indices (0-5)
      const success = this.kinect.trackPixelsForBodyIndices([0, 1, 2, 3, 4, 5]);
      if (!success) {
        reject(new Error("Failed to track body indices"));
        return;
      }

      this.tracking.bodyIndex = true;
      this.fpsCounts.bodyIndex = 0;
      this.fpsTimer.bodyIndex = Date.now();
      this.fps.bodyIndex = 0;

      this.kinect.on("bodyIndexFrame", (frame: BodyIndexFrame) => {
        // Update FPS counters
        this.fpsCounts.bodyIndex++;
        const now = Date.now();
        const elapsed = now - this.fpsTimer.bodyIndex;

        if (elapsed >= 1000) {
          this.fps.bodyIndex = Math.round((this.fpsCounts.bodyIndex * 1000) / elapsed);
          this.fpsTimer.bodyIndex = now;
          this.fpsCounts.bodyIndex = 0;

          // Emit FPS update
          this.emit(EventTypes.fpsUpdate, { ...this.fps });
        }

        // Store latest frame
        this.latestFrames.bodyIndex = frame;

        // Emit body index frame event
        this.emit(EventTypes.bodyIndexFrame, frame);
      });

      resolve(true);
    });
  }

  /**
   * Start tracking color frames
   */
  trackColor(): Promise<boolean> {
    if (this.tracking.color) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      if (!this.initialized) {
        reject(new Error("Kinect not initialized"));
        return;
      }

      const success = this.kinect.openColorReader();
      if (!success) {
        reject(new Error("Failed to open color reader"));
        return;
      }

      this.tracking.color = true;
      this.fpsCounts.color = 0;
      this.fpsTimer.color = Date.now();
      this.fps.color = 0;

      this.kinect.on("colorFrame", (frame: ColorFrame) => {
        // Update FPS counters
        this.fpsCounts.color++;
        const now = Date.now();
        const elapsed = now - this.fpsTimer.color;

        if (elapsed >= 1000) {
          this.fps.color = Math.round((this.fpsCounts.color * 1000) / elapsed);
          this.fpsTimer.color = now;
          this.fpsCounts.color = 0;

          // Emit FPS update
          this.emit(EventTypes.fpsUpdate, { ...this.fps });
        }

        // Store latest frame
        this.latestFrames.color = frame;

        // Emit color frame event
        this.emit(EventTypes.colorFrame, frame);
      });

      resolve(true);
    });
  }

  /**
   * Start tracking depth frames
   */
  trackDepth(): Promise<boolean> {
    if (this.tracking.depth) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      if (!this.initialized) {
        reject(new Error("Kinect not initialized"));
        return;
      }

      const success = this.kinect.openDepthReader();
      if (!success) {
        reject(new Error("Failed to open depth reader"));
        return;
      }

      this.tracking.depth = true;
      this.fpsCounts.depth = 0;
      this.fpsTimer.depth = Date.now();
      this.fps.depth = 0;

      this.kinect.on("depthFrame", (frame: DepthFrame) => {
        // Update FPS counters
        this.fpsCounts.depth++;
        const now = Date.now();
        const elapsed = now - this.fpsTimer.depth;

        if (elapsed >= 1000) {
          this.fps.depth = Math.round((this.fpsCounts.depth * 1000) / elapsed);
          this.fpsTimer.depth = now;
          this.fpsCounts.depth = 0;

          // Emit FPS update
          this.emit(EventTypes.fpsUpdate, { ...this.fps });
        }

        // Store latest frame
        this.latestFrames.depth = frame;

        // Emit depth frame event
        this.emit(EventTypes.depthFrame, frame);
      });

      resolve(true);
    });
  }

  trackHand(hand: Joint | undefined, handType: "left" | "right", bodyTimestamp: number): null | SwipeResult {
    if (!hand || hand.trackingState !== 2) return null; // Not tracked

    const now = Date.now();
    const handData = handType === "left" ? this.handTracker.leftHand : this.handTracker.rightHand;

    handData.positions.push({
      bodyTimestamp: bodyTimestamp,
      timestamp: now,
      x: hand.cameraX,
      y: hand.cameraY,
      z: hand.cameraZ,
    });

    while (handData.positions.length > 0 && now - handData.positions[0].timestamp > this.swipeConfig.trackingDuration) {
      handData.positions.shift();
    }

    if (handData.positions.length >= 2 && now - handData.lastSwipeTime > this.swipeConfig.cooldownPeriod) {
      const swipe = this.detectSwipe(handData.positions);
      if (swipe) {
        this.log(
          `${handType.toUpperCase()} HAND SWIPE DETECTED: ${swipe.direction.toUpperCase()} (${swipe.distance.toFixed(2)}m at ${swipe.velocity.toFixed(2)}m/s)`,
        );
        handData.lastSwipeTime = now;
        handData.positions = [];
        return swipe;
      }
    }

    return null;
  }

  /**
   * Start tracking infrared frames
   */
  trackInfrared(): Promise<boolean> {
    if (this.tracking.infrared) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      if (!this.initialized) {
        reject(new Error("Kinect not initialized"));
        return;
      }

      const success = this.kinect.openInfraredReader();
      if (!success) {
        reject(new Error("Failed to open infrared reader"));
        return;
      }

      this.tracking.infrared = true;
      this.fpsCounts.infrared = 0;
      this.fpsTimer.infrared = Date.now();
      this.fps.infrared = 0;

      this.kinect.on("infraredFrame", (frame: InfraredFrame) => {
        // Update FPS counters
        this.fpsCounts.infrared++;
        const now = Date.now();
        const elapsed = now - this.fpsTimer.infrared;

        if (elapsed >= 1000) {
          this.fps.infrared = Math.round((this.fpsCounts.infrared * 1000) / elapsed);
          this.fpsTimer.infrared = now;
          this.fpsCounts.infrared = 0;

          // Emit FPS update
          this.emit(EventTypes.fpsUpdate, { ...this.fps });
        }

        // Store latest frame
        this.latestFrames.infrared = frame;

        // Emit infrared frame event
        this.emit(EventTypes.infraredFrame, frame);
      });

      resolve(true);
    });
  }

  /**
   * Start tracking long exposure infrared frames
   */
  trackLongExposureInfrared(): Promise<boolean> {
    if (this.tracking.longExposureInfrared) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      if (!this.initialized) {
        reject(new Error("Kinect not initialized"));
        return;
      }

      const success = this.kinect.openLongExposureInfraredReader();
      if (!success) {
        reject(new Error("Failed to open long exposure infrared reader"));
        return;
      }

      this.tracking.longExposureInfrared = true;
      this.fpsCounts.longExposureInfrared = 0;
      this.fpsTimer.longExposureInfrared = Date.now();
      this.fps.longExposureInfrared = 0;

      this.kinect.on("longExposureInfraredFrame", (frame: LongExposureInfraredFrame) => {
        // Update FPS counters
        this.fpsCounts.longExposureInfrared++;
        const now = Date.now();
        const elapsed = now - this.fpsTimer.longExposureInfrared;

        if (elapsed >= 1000) {
          this.fps.longExposureInfrared = Math.round((this.fpsCounts.longExposureInfrared * 1000) / elapsed);
          this.fpsTimer.longExposureInfrared = now;
          this.fpsCounts.longExposureInfrared = 0;

          // Emit FPS update
          this.emit(EventTypes.fpsUpdate, { ...this.fps });
        }

        // Store latest frame
        this.latestFrames.longExposureInfrared = frame;

        // Emit long exposure infrared frame event
        this.emit(EventTypes.longExposureInfraredFrame, frame);
      });

      resolve(true);
    });
  }

  /**
   * Start tracking multi-source frames
   */
  trackMultiSource(options: MultiSourceOptions): Promise<boolean> {
    if (this.tracking.multiSource) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      if (!this.initialized) {
        reject(new Error("Kinect not initialized"));
        return;
      }

      // Build frame type mask from options
      const frameTypes = options.frameTypes.reduce((mask, frameType) => mask | frameType, 0);

      const success = this.kinect.openMultiSourceReader({
        frameTypes,
        includeJointFloorData: options.includeJointFloorData ?? false,
      });

      if (!success) {
        reject(new Error("Failed to open multi-source reader"));
        return;
      }

      this.tracking.multiSource = true;
      this.fpsCounts.multiSource = 0;
      this.fpsTimer.multiSource = Date.now();
      this.fps.multiSource = 0;

      this.kinect.on("multiSourceFrame", (frame: MultiSourceFrame) => {
        // Update FPS counters
        this.fpsCounts.multiSource++;
        const now = Date.now();
        const elapsed = now - this.fpsTimer.multiSource;

        if (elapsed >= 1000) {
          this.fps.multiSource = Math.round((this.fpsCounts.multiSource * 1000) / elapsed);
          this.fpsTimer.multiSource = now;
          this.fpsCounts.multiSource = 0;

          // Emit FPS update
          this.emit(EventTypes.fpsUpdate, { ...this.fps });
        }

        // Store latest frame
        this.latestFrames.multiSource = frame;

        // Emit multi-source frame event
        this.emit(EventTypes.multiSourceFrame, frame);

        // Also emit individual frame events if available
        if (frame.color) {
          this.emit(EventTypes.colorFrame, frame.color);
        }

        if (frame.depth) {
          this.emit(EventTypes.depthFrame, frame.depth);
        }

        if (frame.infrared) {
          this.emit(EventTypes.infraredFrame, frame.infrared);
        }

        if (frame.longExposureInfrared) {
          this.emit(EventTypes.longExposureInfraredFrame, frame.longExposureInfrared);
        }

        if (frame.rawDepth) {
          this.emit(EventTypes.rawDepthFrame, frame.rawDepth);
        }

        if (frame.body) {
          this.emit(EventTypes.bodyFrame, frame.body);
        }

        if (frame.bodyIndex) {
          this.emit(EventTypes.bodyIndexFrame, frame.bodyIndex);
        }
      });

      resolve(true);
    });
  }

  /**
   * Start tracking raw depth frames
   */
  trackRawDepth(): Promise<boolean> {
    if (this.tracking.rawDepth) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      if (!this.initialized) {
        reject(new Error("Kinect not initialized"));
        return;
      }

      const success = this.kinect.openRawDepthReader();
      if (!success) {
        reject(new Error("Failed to open raw depth reader"));
        return;
      }

      this.tracking.rawDepth = true;
      this.fpsCounts.rawDepth = 0;
      this.fpsTimer.rawDepth = Date.now();
      this.fps.rawDepth = 0;

      this.kinect.on("rawDepthFrame", (frame: RawDepthFrame) => {
        // Update FPS counters
        this.fpsCounts.rawDepth++;
        const now = Date.now();
        const elapsed = now - this.fpsTimer.rawDepth;

        if (elapsed >= 1000) {
          this.fps.rawDepth = Math.round((this.fpsCounts.rawDepth * 1000) / elapsed);
          this.fpsTimer.rawDepth = now;
          this.fpsCounts.rawDepth = 0;

          // Emit FPS update
          this.emit(EventTypes.fpsUpdate, { ...this.fps });
        }

        // Store latest frame
        this.latestFrames.rawDepth = frame;

        // Emit raw depth frame event
        this.emit(EventTypes.rawDepthFrame, frame);
      });

      resolve(true);
    });
  }

  // Protected method to emit events with type checking
  protected emit<E extends EventType>(event: E, arg: EventMap[E]): boolean {
    return this.emitter.emit(event, arg);
  }

  /**
   * Calculate angle between three joints
   * @param joint1 First joint
   * @param joint2 Middle joint (vertex)
   * @param joint3 Third joint
   * @returns Angle in degrees
   */
  private calculateAngle(joint1: Joint, joint2: Joint, joint3: Joint): number {
    // Create vectors from the middle joint to the other two
    const vector1 = {
      x: joint1.cameraX - joint2.cameraX,
      y: joint1.cameraY - joint2.cameraY,
      z: joint1.cameraZ - joint2.cameraZ,
    };

    const vector2 = {
      x: joint3.cameraX - joint2.cameraX,
      y: joint3.cameraY - joint2.cameraY,
      z: joint3.cameraZ - joint2.cameraZ,
    };

    // Calculate dot product
    const dotProduct = vector1.x * vector2.x + vector1.y * vector2.y + vector1.z * vector2.z;

    // Calculate magnitudes
    const magnitude1 = Math.sqrt(vector1.x * vector1.x + vector1.y * vector1.y + vector1.z * vector1.z);
    const magnitude2 = Math.sqrt(vector2.x * vector2.x + vector2.y * vector2.y + vector2.z * vector2.z);

    // Calculate the angle in radians
    const cosAngle = dotProduct / (magnitude1 * magnitude2);

    // Convert to degrees and ensure valid range
    const angleRadians = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    return angleRadians * (180 / Math.PI);
  }

  private handStateToString(handState: number): HandState {
    switch (handState) {
      case Kinect2.HandState.closed:
        return "closed";
      case Kinect2.HandState.lasso:
        return "lasso";
      case Kinect2.HandState.notTracked:
        return "notTracked";
      case Kinect2.HandState.open:
        return "open";
      default:
        return "unknown";
    }
  }

  /**
   * Convert hand state enum value to string representation
   * @param handState Hand state enum value
   * @returns String representation of hand state
   */

  private log(data: unknown) {
    if (this.debug) {
      console.debug(data);
    }
  }
}
