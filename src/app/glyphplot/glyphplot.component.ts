import {Component, ElementRef, HostListener, Input, OnChanges, OnInit, ViewChild} from '@angular/core';

import {Logger} from 'src/app/shared/services/logger.service';

import {Glyph} from 'src/app/glyph/glyph';
import {DotGlyph} from 'src/app/glyph/glyph.dot';
import {FlowerGlyph} from 'src/app/glyph/glyph.flower';
import {GlyphplotEventController} from './glyphplot.event.controller';
import {FlexiWallController} from './glyphplot.flexiwall.controller';
import {Helper} from 'src/app/glyph/glyph.helper';

import {TooltipComponent} from 'src/app/tooltip/tooltip.component';
import {SelectionRect} from './selection-rect';
import {Configuration} from '../shared/services/configuration.service';
import {ConfigurationData} from '../shared/services/configuration.data';

import {LenseCursor} from 'src/app/lense/cursor.service';
import {EventAggregatorService} from 'src/app/shared/events/event-aggregator.service';
import { FlowerGlyphConfiguration } from 'src/app/glyph/glyph.flower.configuration';
import { GlyphType } from 'src/app/glyph/glyph.type';
import { FitToSelectionEvent } from 'src/app/shared/events/fit-to-selection.event';
import { FitToSelectionTransmitterEvent } from 'src/app/shared/events/fit-to-selection-transmitter.event';
import { UpdateZoomIdentityEvent } from 'src/app/shared/events/update-zoom-identity.event';
import * as d3 from 'd3';
import { GlyphplotLayoutController } from './glyphplot.layout.controller';
import { GlyphLayout } from 'src/app/glyph/glyph.layout';
import { DotGlyphConfiguration } from 'src/app/glyph/glyph.dot.configuration';

@Component({
  selector: 'app-glyphplot',
  templateUrl: './glyphplot.component.html',
  styleUrls: ['./glyphplot.component.css']
})
export class GlyphplotComponent implements OnInit, OnChanges {
  @ViewChild('chart', { static: false }) public chartContainer: ElementRef | undefined;
  @ViewChild('selectionrectangle') public selectionRectangle: ElementRef | undefined;
  @ViewChild('tooltip') public tooltip: TooltipComponent | undefined;
  @Input() width: number = 0;
  @Input() height: number = 0;

  private _data: any;
  private _configuration: ConfigurationData;
  private _context: any;
  private _selectionContext: any;
  private _xAxis: any;
  private _yAxis: any;
  private _originalWidth: number = 0;
  private _originalHeight: number = 0;
  private _transform: any = d3.zoomIdentity;
  private _selectionRect: SelectionRect;
  private _eventController: GlyphplotEventController;
  private _layoutController: GlyphplotLayoutController;
  private _flexiWallController: FlexiWallController;
  private _circle: Glyph;
  private _simulation: any;
  private _currentLayout: any;
  private _drawLock: boolean = false;
  private _suppressAnimations = false;
  private _uniqueID: string;
  private _zoom: any;
  private _quadtree: any;
  private _clusterPoints: any;
  private _dataUpdated: boolean = false;

  //#region static methods
  static zoomed(event: any, component: GlyphplotComponent): void {
    component.eventController.onZoomed(event);
  }

  static dragStart(event: any, component: GlyphplotComponent): void {
    component.eventController.onDragStart(event);
  }

  static dragEnd(event: any, component: GlyphplotComponent): void {
    component.eventController.onDragEnd(event);
  }

  static ticked(component: GlyphplotComponent): void {
    component.eventController.onTicked();
  }
  //#endregion

  //#region HostListeners
  @HostListener('document:keydown', ['$event'])
  @HostListener('document:keyup', ['$event'])
  keypress(e: KeyboardEvent) {
    this._eventController.onKeyPress(e);
  }

  @HostListener('mousemove', ['$event'])
  mouseMove(e: MouseEvent) {
    this._eventController.onMouseMove(e);
  }

  @HostListener('click', ['$event'])
  click(e: MouseEvent) {
    this._eventController.onClick(e);
  }
  //#endregion

  constructor(
    private logger: Logger,
    private helper: Helper,
    private configurationService: Configuration,
    private cursor: LenseCursor,
    private eventAggregator: EventAggregatorService
  ) {
    this._configuration = this.configurationService.addConfiguration();
    this._circle = new DotGlyph(this.context, 0, new DotGlyphConfiguration());
    this._selectionRect = new SelectionRect(this, this.context, this.helper);
    this._eventController = new GlyphplotEventController(
      this,
      this.configuration,
      this.cursor,
      this.logger,
      this.configurationService,
      this.eventAggregator
    );
    this._flexiWallController = new FlexiWallController(
      this,
      this.logger,
      this.cursor,
      this.configuration
    );
    this._layoutController = new GlyphplotLayoutController(
      this,
      this.logger,
      this.configurationService
    );
    this.configuration.leftSide = this.configurationService.configurations.length === 1;
    if (this.configuration.leftSide) {
      // Flexiwall connection only for first glyphboard component
      this._flexiWallController.doWebSocket();
    }
    this._uniqueID = Math.random()
      .toString(36)
      .substring(2);
    this.configuration.getData().subscribe(message => {
      this.data = message;
      if (this.data) {
        if (this.configuration.leftSide) {
          this.dataUpdated = true;
        }
        this.createChart();
      }
    });
    this.configuration.uniqueID = this.uniqueID;
    this.eventAggregator
      .getEvent(FitToSelectionTransmitterEvent)
      .subscribe(this.fitToSelectionTransmitter);
    this.eventAggregator
      .getEvent(UpdateZoomIdentityEvent)
      .subscribe(this.updateZoomIdentity);
  }

  //#region initialization and update methods

  ngOnInit(): void {
    this._originalHeight = this.height;
    this._originalWidth = this.width;
  }

  ngOnChanges(): void {
    this.logger.log('The component is changed ' + this._uniqueID);
    if (this.context === undefined) {
      return;
    }
    if (this.width === 0 || this.height === 0) {
      return;
    }
    this.selectionRect.offset = {
      x: this.configuration.leftSide ? 0 : window.innerWidth - this.width,
      y: 0
    };
    this._layoutController.updatePositions();
    this.updateZoom();
    this.animate();
  }

  createChart(): void {
    const that = this;

    const element = this.chartContainer?.nativeElement;
    this.selectionContext = this.selectionRectangle?.nativeElement.getContext('2d');

    this.context = element.getContext('2d');
    if(this.tooltip !== undefined) this.tooltip.data = this.data;

    this.currentLayout = this.configuration.currentLayout;
    const colorFeature = this.data.schema.color;
    const colorScale = (item: any) => {
      return item === undefined
        ? 0
        : this.configuration.color(+item[colorFeature]);
    };

    this.configuration.glyph = new FlowerGlyph(
      this.context,
      colorScale,
      this.configurationService.flowerConfigs[2] as FlowerGlyphConfiguration
    );
    this.circle = new DotGlyph(this.context, colorScale, new DotGlyphConfiguration());
    this.selectionRect = new SelectionRect(this, this.selectionContext, this.helper);
    this.selectionRect.data = this.data;
    this.selectionRect.offset = {
      x: this.configuration.leftSide ? 0 : window.innerWidth - this.width,
      y: 0
    };

    this._simulation = d3
      .forceSimulation()
      .force('collision', d3.forceCollide().radius(20))
      .on('end', () => {
        GlyphplotComponent.ticked(that);
      })
      .stop();

    this._layoutController.updatePositions();
    this.updateZoom();
    this.configuration.updateCurrentLevelOfDetail(this.configuration.zoomIdentity.k);
    this.animate();
  }

  public updateZoom() {
    const that = this;
    const element = this.chartContainer?.nativeElement;
    const rectangle = this.selectionRectangle?.nativeElement;
    let scaleBase = 1 *
      Math.min(this.height / this._originalHeight, this.width / this._originalWidth);
    scaleBase = this.configuration.minScaleLevel;
    this.zoom = d3.zoom()
      .scaleExtent([scaleBase, this.configuration.maxZoom])
      .on('start', (event, d) => {
        GlyphplotComponent.dragStart(event, that);
      })
      .on('zoom', (event, d) => {
        GlyphplotComponent.zoomed(event, that);
      })
      .on('end', (event, d) => {
        GlyphplotComponent.dragEnd(event, that);
      });

    const canvas = d3
      .select(element)
      .attr('width', this.width)
      .attr('height', this.height)
      .call(this.zoom);
    // const selection = d3
    //   .select(rectangle)
    //   .style('left', this.configuration.leftSide ? '0' : this.width)
    //   .attr('width', this.width)
    //   .attr('height', this.height);
  }
  //#endregion

  //#region drawing methods

  /**
   * Draws every datapoint at their respective x ("current x") and y position. Differentiates
   * between glyph and circle. Draws the tooltip box.
   */
  draw(): void {
    this.drawLock = true;

    const that = this;
    const context = this.context;

    // check if the layout was changed externally (e.g. by the dashboardcomponent) and reorder the
    // glyphs if necessary
    if (this.currentLayout !== this.configuration.currentLayout) {
      if (
        this.configuration.currentLayout === GlyphLayout.Matrix
      ) {
        this.matrixLayout();
        this.animate();
      } else if (
        this.configuration.currentLayout === GlyphLayout.Cluster
      ) {
        this.animate();
      }

      this.currentLayout = this.configuration.currentLayout;
      return;
    }

    context.save();
    context.clearRect(0, 0, this.width, this.height);

    // check for and handle jumps in level-of-detail
    if (
      this.configuration.previousLevelOfDetail === 0 &&
      this.configuration.currentLevelOfDetail === 1
    ) {
      // going to level 1 coming from level 0 -> show glyphs
      this.animateGlyphs();
      this.configuration.updateCurrentLevelOfDetail(this.configuration.zoomIdentity.k);
      this.updateGlyphConfiguration();
      this.solveCollisions();
    } else if (
      this.configuration.previousLevelOfDetail === 1 &&
      this.configuration.currentLevelOfDetail === 0
    ) {
      // going to level 0 coming from level 1 -> hide glyphs and show dots
      this.animateGlyphs();
      this.configuration.updateCurrentLevelOfDetail(this.configuration.zoomIdentity.k);
      this.updateGlyphConfiguration();
      this._simulation.stop();
    } else {
      this.updateGlyphConfiguration();
      this.configuration.updateCurrentLevelOfDetail(this.configuration.zoomIdentity.k);
      // level of detail did not change, so redraw each glyph at it's current
      // position
      this._layoutController.getPositions().forEach((d: any) => {
        // don't draw glyphs that lie outside the view
        if (this.helper.checkClipping(d.position)) {
          return;
        }

        this.context.beginPath();
        this.context.moveTo(d.position.x, d.position.y);

        const data = this.layoutController.getFeaturesForItem(d);

        if (this.configuration?.filteredItemsIds.indexOf(d.id) > -1 || this.configuration?.featureFilters.length == 0) {
          this.layoutController.drawSingleGlyph(d.position, data!.features, 0, false, false, 0);
        } else {
          this.layoutController.drawSingleGlyph(d.position, data!.features, 1.0, true, d.id === this.configuration.idOfHoveredGlyph, 0);
        }
      });

      // set the radius of collision forces according to the current zoomlevel
      if (this.configuration?.currentLevelOfDetail === 1) {
        this._simulation.force('collision', d3.forceCollide().radius(this.configurationService.smallGlyphRadius));
      } else if (this.configuration?.currentLevelOfDetail === 2) {
        this._simulation.force('collision', d3.forceCollide().radius(this.configurationService.largeGlyphRadius));
      }

      // handle overlapping / collisions between glyphs (don't resolve dots)
      if (
        this.configuration?.currentLevelOfDetail > 0 &&
        !this.configuration?.useDragSelection
      ) {
        if (!this._suppressAnimations) { this.solveCollisions(); }
      }
    }

    context.restore();
    this.selectionRect?.clear();
    this.drawLock = false;
  }

  private updateGlyphConfiguration() {
    switch (this.configurationService.activeGlyphType) {
      case GlyphType.Star:
        this.configuration.glyph.configuration =
          this.configurationService.starConfigs[this.configuration.currentLevelOfDetail];
      break;
      default:
        this.configuration.glyph.configuration =
          this.configurationService.flowerConfigs[this.configuration.currentLevelOfDetail];
      break;
    }
  }

  /**
   * Updates the x and y coordinates of the datapoints according to the currently selected layouting
   * mode GlyphLayout, at which they are drawn
   * by draw().
   */
  public updateGlyphLayout(updateAllItems: boolean = false): void {
    if (this.data === undefined || this.data.length === 0) {
      return;
    }
    const that = this;
    const items = updateAllItems ? this.data.positions : this._layoutController.getPositions();
    items.forEach((d: any) => {
      if (
        that.configuration?.currentLayout === GlyphLayout.Cluster
      ) {
        d.position.x = that.configuration.zoomIdentity.applyX(that.xAxis(d.position.ox));
        d.position.y = that.configuration.zoomIdentity.applyY(that.yAxis(d.position.oy));
      } else if (
        that.configuration?.currentLayout === GlyphLayout.Matrix
      ) {
        d.position.x = d.position.tx;
        d.position.y = d.position.ty;
      }
    });
  }

  /**
   * Sets the cx and cy coordinates of all glyphs on the screen to fit a
   * matrix layout. Uses the sortFunction parameter to change the order in which
   * glyphs are arranged.
   * @param sortFunction {Function} function to sorting glyphs by (default is
   *                                sort by popularitaet property)
   */
  public matrixLayout(sortFunction?: any): void {
    const that = this;
    const visiblePositions: Array<any> = this.data.positions.filter(
      (p: any) => !this.helper.checkClipping(p.position)
    );
    const visibleFeatures: Array<any> = this.data.features.filter((f: any) => {
      return visiblePositions.find(p => p.id === f.id) != null;
    });
    const sortedPositions: Array<any> = [];

    // if sort function is not provided, sort by color
    if (sortFunction == null) {
      const colorProperty = this.data.schema.color;
      sortFunction = (a: any, b: any) =>
        +a.features[colorProperty] - +b.features[colorProperty];
    }

    visibleFeatures.sort(sortFunction);

    visibleFeatures.forEach(f => {
      sortedPositions.push(visiblePositions.find(g => g.id === f.id));
    });

    let row = 0;
    let column = 0;
    let spacingX: number =
      this.width / Math.ceil(Math.sqrt(sortedPositions.length));
    let spacingY: number =
      this.height / Math.ceil(Math.sqrt(sortedPositions.length));

    // prevent overlapping
    spacingX = Math.max(100, spacingX);
    spacingY = Math.max(100, spacingY);

    // fill up the matrix row by row from left to right in columns.
    sortedPositions.forEach(p => {
      p.position.tx = column++ * spacingX + 55;
      p.position.ty = row * spacingY + 55;

      // reset column to 0 and increase row
      if (column > Math.floor(Math.sqrt(visiblePositions.length))) {
        row++;
        column = 0;
      }
    });
  }

  /**
   * Restarts the node-simulation to resolve overlappings/collisions between
   * glyphs.
   */
  private solveCollisions(): void {
    if (!this.configuration.useForceLayout) { return; }

    this.simulation
      .nodes(
        this.data.positions
          .filter((d: any) => !this.helper.checkClipping(d.position))
          .map((d: any) => d.position)
      )
      .restart();
  }

  /**
   * Repeatedly redraws the current glyph with an increasing radius until the
   * max radius is reached. This creates a 'blossoming' effect for the glyphs.
   */
  private animateGlyphs(): void {
    if (!this._suppressAnimations) {
      const timer = d3.timer(elapsed => {
        const t = Math.min(
          1,
          d3.easeCubic(elapsed / this.configuration.duration)
        );

        this.doAnimateGlyphs(t);

        if (t === 1) {
          timer.stop();
        }
      });
    } else {
      this.doAnimateGlyphs(1);
    }
  }

    /**
   * Subroutine of animate(). Takes a percentage of elapesed time and renders the 'blooming'
   * animation between glyphs on level of detail 1 and 2.
   * @param   t {number} step of the animation to be rendered with 0 <= t <= 1
   * @return  {void}
   */
  private doAnimateGlyphs(t: number) {
    this.context.clearRect(0, 0, this.width, this.height);

    this._layoutController.getPositions().forEach((d: any) => {
      if (this.helper.checkClipping(d.position)) {
        return;
      }

      this.context.beginPath();
      this.context.moveTo(d.position.x, d.position.y);

      const features = this._layoutController.getFeaturesForItem(d)!.features;

      // draw the circle glyph and the current glyph to improve the blossoming effect
      if (this.configuration.currentLevelOfDetail > 0) {
        this.configuration.glyph.draw(d.position, features, t);
        this.circle.draw(d.position, features, 1 - t);
      } else {
        this.configuration.glyph.draw(d.position, features, 1 - t);
        this.circle.draw(d.position, features, t);
      }
    });
  }

  /**
   * Interpolates the position of each point between the last and the current zoom-transformation.
   * Animates the zooming. If targetData is given, uses the coordinates that are
   * stored in the tx and ty properties in the given data instead of calling
   * updateGlyphLayout().
   */
  public animate(targetData?: any): void {
    this.drawLock = true;
    // save current 'source' positions
    this._layoutController.getPositions().forEach((d: any) => {
      d.position.sx = d.position.x;
      d.position.sy = d.position.y;
    });

    if (!arguments.length) {
      // set cx to the target positions using the latest zoom-transform
      this.updateGlyphLayout();

      // save the target positions
      this._layoutController.getPositions().forEach((d: any) => {
        d.position.tx = d.position.x;
        d.position.ty = d.position.y;
      });
    }

    if (this._suppressAnimations) {
      this.draw();
    } else {
      const that = this;
      const duration = 500; // duration of one animation-step

      // interpolate between source and target positions
      const timer = d3.timer(elapsed => {
        const t = Math.min(1, d3.easeCubic(elapsed / duration));

        that._layoutController.getPositions().forEach((d: any) => {
          d.position.x = d.position.sx * (1 - t) + d.position.tx * t;
          d.position.y = d.position.sy * (1 - t) + d.position.ty * t;
        });

        that.draw();

        if (t === 1) {
          timer.stop();
        }
      });
    }
    this.drawLock = false;
  }

  public fitToSelectionTransmitter = (payload: boolean) => {
    this.eventAggregator.getEvent(FitToSelectionEvent).publish(this._uniqueID);
  }

  private updateZoomIdentity = (payload: boolean) => {
    this.updateGlyphLayout
  }
  //#endregion

  //#region getters and setters
  get simulation(): any {
    return this._simulation;
  }
  set simulation(s: any) {
    this._simulation = s;
  }
  get eventController(): GlyphplotEventController {
    return this._eventController;
  }
  get suppressAnimations(): boolean {
    return this._suppressAnimations;
  }
  set suppressAnimations(flag: boolean) {
    this._suppressAnimations = flag;
  }
  get data(): any {
    return this._data;
  }
  set data(value: any) {
    this._data = value;
  }
  set circle(circle: Glyph) {
    this._circle = circle;
  }
  get circle(): Glyph {
    return this._circle;
  }
  get selectionRect(): SelectionRect {
    return this._selectionRect;
  }
  get originalHeight(): any {
    return this._originalHeight;
  }
  get originalWidth(): any {
    return this._originalWidth;
  }
  set selectionRect(value: SelectionRect) {
    this._selectionRect = value;
  }
  get xAxis() { return this._xAxis; }
  set xAxis(value: any) { this._xAxis = value; }
  get yAxis() { return this._yAxis; }
  set yAxis(value: any) { this._yAxis = value; }
  get configuration(): ConfigurationData { return this._configuration; }
  set configuration(value: ConfigurationData) { this._configuration = value; }
  get zoom() { return this._zoom; }
  set zoom(value: any) { this._zoom = value; }
  get context() { return this._context; }
  set context(value: any) { this._context = value; }
  get drawLock() { return this._drawLock; }
  set drawLock(value: boolean) { this._drawLock = value; }
  get currentLayout() { return this._currentLayout }
  set currentLayout(value: any) { this._currentLayout = value; }
  get quadtree() { return this._quadtree }
  set quadtree(value: any) { this._quadtree = value; }
  get clusterPoints() { return this._clusterPoints }
  set clusterPoints(value: any) { this._clusterPoints = value; }
  get selectionContext() { return this._selectionContext }
  set selectionContext(value: any) { this._selectionContext = value; }
  get layoutController() { return this._layoutController; }
  get dataUpdated() { return this._dataUpdated; }
  set dataUpdated(value: boolean) { this._dataUpdated = value; }
  get uniqueID() {return this._uniqueID; }
  //#endregion
}
