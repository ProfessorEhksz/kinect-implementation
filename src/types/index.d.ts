/* eslint-disable @typescript-eslint/no-unsafe-function-type */
// Type declaration for Kinect2 module to ensure proper typing
declare module "kinect2" {
  export default class Kinect2 {
    static FrameType: {
      body: number;
      bodyIndex: number;
      color: number;
      depth: number;
      infrared: number;
      longExposureInfrared: number;
      rawDepth: number;
    };

    static HandState: {
      closed: 3;
      lasso: 4;
      notTracked: 1;
      open: 2;
      unknown: 0;
    };

    static JointType: {
      ankleLeft: 14;
      ankleRight: 18;
      elbowLeft: 5;
      elbowRight: 9;
      footLeft: 15;
      footRight: 19;
      handLeft: 7;
      handRight: 11;
      handTipLeft: 21;
      handTipRight: 23;
      head: 3;
      hipLeft: 12;
      hipRight: 16;
      kneeLeft: 13;
      kneeRight: 17;
      neck: 2;
      shoulderLeft: 4;
      shoulderRight: 8;
      spineBase: 0;
      spineMid: 1;
      spineShoulder: 20;
      thumbLeft: 22;
      thumbRight: 24;
      wristLeft: 6;
      wristRight: 10;
    };

    static TrackingState: {
      inferred: 1;
      notTracked: 0;
      tracked: 2;
    };

    constructor();
    close(callback: (err: Error | null, result: boolean) => void): void;
    closeBodyReader(callback: (err: Error | null, result: boolean) => void): void;

    closeColorReader(callback: (err: Error | null, result: boolean) => void): void;
    closeDepthReader(callback: (err: Error | null, result: boolean) => void): void;

    closeInfraredReader(callback: (err: Error | null, result: boolean) => void): void;
    closeLongExposureInfraredReader(callback: (err: Error | null, result: boolean) => void): void;

    closeMultiSourceReader(callback: (err: Error | null, result: boolean) => void): void;
    closeRawDepthReader(callback: (err: Error | null, result: boolean) => void): void;

    on(event: string, listener: Function): this;
    open(): boolean;

    openBodyReader(): boolean;
    openColorReader(): boolean;

    openDepthReader(): boolean;
    openInfraredReader(): boolean;

    openLongExposureInfraredReader(): boolean;
    openMultiSourceReader(options: { frameTypes: number; includeJointFloorData?: boolean }): boolean;

    openRawDepthReader(): boolean;

    removeListener(event: string, listener: Function): this;
    trackPixelsForBodyIndices(indices: number[]): boolean;
  }
}
