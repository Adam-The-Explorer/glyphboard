import { Component, OnInit, ElementRef, ViewChild, HostListener, OnChanges, AfterViewInit } from '@angular/core';
import { RegionManager } from 'src/app/region/region.manager';
import { Input } from '@angular/core';
import { IdFilter } from 'src/app/shared/filter/id-filter';
import { FeatureFilter } from 'src/app/shared/filter/feature-filter';
import { LenseCursor } from './../lense/cursor.service';
import { TooltipComponent} from 'src/app/tooltip/tooltip.component';

import { Configuration } from 'src/app/shared/services/configuration.service';
import { ConfigurationData} from 'src/app/shared/services/configuration.data';
import { EventAggregatorService} from 'src/app/shared/events/event-aggregator.service';
import { Logger } from 'src/app/shared/services/logger.service';

import * as THREE from 'three';
import * as d3 from 'd3';
import { RefreshPlotEvent } from 'src/app/shared/events/refresh-plot.event';
import { RefreshHoverEvent } from 'src/app/shared/events/refresh-hover.event';
import { RefreshHoverEventData } from 'src/app/shared/events/refresh-hover.event.data';
import { ViewportTransformationEvent } from 'src/app/shared/events/viewport-transformation.event';
import { ViewportTransformationEventData } from 'src/app/shared/events/viewport-transformation.event.data';
import { InteractionEvent} from 'src/app/shared/events/interaction.event';
import { InteractionEventData} from 'src/app/shared/events/interaction.event.data';
import { Interaction} from 'src/app/shared/util/interaction';
import { SelectionService } from 'src/app/shared/services/selection.service';

import { GlyphLayout } from 'src/app/glyph/glyph.layout';
import { SelectionRect } from 'src/app/glyphplot/selection-rect';
import { Helper } from 'src/app/glyph/glyph.helper';
import { UpdateItemsStrategy } from 'src/app/shared/util/UpdateItemsStrategy';
import { FitToSelectionEvent } from 'src/app/shared/events/fit-to-selection.event';
import { Vector2 } from 'three';
import { CameraSyncUtilities } from 'src/app/shared/util/cameraSyncUtilities';
import { SwitchVisualizationEvent, VisualizationType } from 'src/app/shared/events/switch-visualization.event';

import { Renderer, IRenderable } from './renderer';
import { View } from './view';
import { DotView } from './dotView';

@Component({
  selector: 'app-glyphplot-webgl',
  templateUrl: './glyphplot-webgl.component.html',
  styleUrls: ['./glyphplot-webgl.component.scss']
})

export class GlyphplotWebglComponent implements OnInit, OnChanges, AfterViewInit {
  @Input() width: number = 0;
  @Input() height: number = 0;

  @ViewChild('selectionrectangle') public selectionRectangle: ElementRef | undefined;
  @ViewChild('tooltip') public tooltip: TooltipComponent | undefined;


  private renderer: Renderer | null = null;
  private activeView: View | null = null;


  public fieldOfView = 60;
  public nearClippingPane = 1;
  public farClippingPane = 1100;

  private cube: THREE.Mesh[] = [];
  private group: THREE.Group | null = null;

  private _configuration: ConfigurationData;
  private _data: any;
  

  private _interactionEvent: Interaction | null = null;
  private _interaction: InteractionEventData = new InteractionEventData(null);
  private _transformation: ViewportTransformationEventData = new ViewportTransformationEventData(this);

  private _selectionRect: SelectionRect | null = null;
  private _context: any;

  private leftSide: boolean = false;

  //event controller
  private counter: number = 0;
  private selectionEnded: boolean = false;
  private saveEndTransform = { x: 0, y: 0 };
  private saveStartTransform = { x: 0, y: 0 };
  private _isDraggingActive: boolean = false;

  //tooltip
  private _isOverTooltip: boolean = false;

  

  private _particleGeometry: THREE.BufferGeometry = new THREE.BufferGeometry();

  @ViewChild('threejscanvas')
  private canvasRef: ElementRef | undefined;

  public manager: RegionManager | null = null;

  constructor(
    private logger: Logger,
    private helper: Helper,
    private regionManager: RegionManager,
    private configurationService: Configuration,
    private eventAggregator: EventAggregatorService,
    private cursor: LenseCursor,
    private selectionService: SelectionService
  ) {
    

    this._configuration = this.configurationService.configurations[0];
    this.eventAggregator.getEvent(RefreshPlotEvent).subscribe(this.onRefreshPlot);
    this.eventAggregator.getEvent(RefreshHoverEvent).subscribe(this.onRefreshHover);
    this.eventAggregator.getEvent(ViewportTransformationEvent).subscribe(this.onViewportTransformationUpdated);
    this.eventAggregator.getEvent(InteractionEvent).subscribe(this.onInteractionUpdated);
    this.eventAggregator.getEvent(FitToSelectionEvent).subscribe(this.fitToSelection);
  }

  ngOnInit(): void {
    this.manager = this.regionManager;
  }

  ngOnChanges(): void {
    if(!this.renderer) {
      return;
    }
    
    this.renderer.onResize(this.width, this.height);
    this.activeView!.updateCameraUtil();
    this.setViewFrustum();
  }

  ngAfterViewInit() {
    this.activeView = new DotView(this.width, this.height);
    this.renderer = new Renderer(this.canvas);
    this.renderer.setView(this.activeView);
    let htmlElement = (this.canvasRef!.nativeElement as HTMLElement);
    this.leftSide = htmlElement !== null && this.regionManager!.regions![3].name === htmlElement.parentElement!.getAttribute("name");    
    if(this.leftSide){
      this._configuration = this.configurationService.configurations[0];
    } else {
      this._configuration = this.configurationService.configurations[1];
    }

    this.activeView!.onConfiguration(this._configuration);
    this.activeView!.onSelection(this.selectionService);

    this.setViewFrustum();
    this.renderer!.onResize(this.width, this.height);
    this.renderer!.draw();


    this._context = this.selectionRectangle!.nativeElement.getContext('2d');

    this._selectionRect = new SelectionRect(this, this._context, this.helper);
    // this._selectionRect.data = this._data;
    this._selectionRect.offset = {
      x: this._configuration.leftSide ? 0 : window.innerWidth - this.width,
      y: 0
    };

    this.tooltip!.data = this._data;
    this.tooltip!.tooltipElement.addEventListener('mouseover', this.onHoverTooltip);
    this.tooltip!.tooltipElement.addEventListener('mouseout', this.onEndHoverTooltip);

    this._configuration.getData().subscribe(message => {
        if (message != null) {
          this._data = message;
          if (this.data) {
            this.selectionService.data = this.data;
          }
          this.activeView!.onSelection(this.selectionService);
          this.activeView!.onConfiguration(this._configuration);
          this.activeView!.onData(this.data);
          this.setViewFrustum();
        }
      });
  }

  

  

  //#region HostListeners
  @HostListener('document:mousedown', ['$event'])
  onMousedown(e: MouseEvent){
    this._isDraggingActive = false;
    this._interactionEvent = Interaction.TouchBegin;
    const data = new InteractionEventData(this._interactionEvent, 
      e.offsetX, e.offsetY);
    this.eventAggregator.getEvent(InteractionEvent).publish(data);

    //tooltip
    if (this.tooltip!.isVisible && !this.tooltip!.isFixed) {
      this.tooltip!.isFixed = true;
    } else if (!this.tooltip!.isEdit) {
      if(this._isOverTooltip == false){
        this.tooltip!.isFixed = false;
      }
    }
  }

  @HostListener('document:mouseup', ['$event'])
  onMouseUp(e: MouseEvent){
    this._interactionEvent = Interaction.TouchEnd;
    const data = new InteractionEventData(this._interactionEvent, 
      e.offsetX, e.offsetY);
    this.eventAggregator.getEvent(InteractionEvent).publish(data);
    this._isDraggingActive = false;
  }
 
  @HostListener('mousemove', ['$event'])
  mouseMove(e: MouseEvent) {
    if (this.data !== undefined) {
      //set id of hovered glyph and find glyph to highlight
      let glyphRadius: number = 5;
      if (this.configurationService.configurations[0].selectedDataSetInfo.name ===
        this.configurationService.configurations[1].selectedDataSetInfo.name) {
        this.configurationService.configurations[0].idOfHoveredGlyph = -1;
        this.configurationService.configurations[1].idOfHoveredGlyph = -1;
      } else {
        this.configuration.idOfHoveredGlyph = -1;
      }
      for (const element of this.data.positions) {
        if (
          Math.abs(element.position.x - d3.pointer(e)[0]) <= glyphRadius &&
          Math.abs(element.position.y - d3.pointer(e)[1]) <= glyphRadius
        ) {
          if (this.configurationService.configurations[0].selectedDataSetInfo.name ===
            this.configurationService.configurations[1].selectedDataSetInfo.name) {
            this.configurationService.configurations[0].idOfHoveredGlyph = element.id;
            this.configurationService.configurations[1].idOfHoveredGlyph = element.id;
          } else {
            this.configuration.idOfHoveredGlyph = element.id;
          }
          break;
        }
      }
    }

    if (e.buttons === 1) {
      if (!this.configuration.useDragSelection) {
        const scale = this._transformation.GetScale();
        const translateX = this._transformation.GetTranslateX() + (-e.movementX / scale)
        const translateY = this._transformation.GetTranslateY() + (-e.movementY / scale);

        const eventData = new ViewportTransformationEventData(this, translateX, translateY, 0, scale, UpdateItemsStrategy.DefaultUpdate,
          this._transformation.GetZoomViewportOffsetX(),
          this._transformation.GetZoomViewportOffsetY(),
          this._transformation.GetZoomViewportOffsetZ(),
          this._transformation.GetZoomCursorOffsetX(),
          this._transformation.GetZoomCursorOffsetY(),
          this._transformation.GetZoomCursorOffsetZ());
        this.eventAggregator.getEvent(ViewportTransformationEvent).publish(eventData);

      } else {
        this._isDraggingActive = true;
        this._interactionEvent = Interaction.Drag;
        const eventData = new InteractionEventData(this._interactionEvent,
          e.offsetX, e.offsetY);
        this.eventAggregator.getEvent(InteractionEvent).publish(eventData);
      }
    }

    //mouse movement for magic lens
    if (this.cursor.isVisible && !this.cursor.isFixed) {
      this.cursor.position = { left: e.clientX, top: e.clientY };
      this.tooltip!.isVisible = false;
    } 
    //show tooltip when hovering
    else if (!this.tooltip!.isFixed && !this.configuration.useDragSelection) {
      if (this.tooltip!.data == null) {
        this.tooltip!.data = this._data;
      }
      this.tooltip!.updateClosestPoint(e, this._transformation);
    } 
    //hide tooltip when point was clicked
    else if (!this.tooltip!.isFixed) {
      this.tooltip!.isVisible = false;
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    if (e.key === ' ') {
      console.log('reset View...');
      this.resetView();
    }
  }

  private resetView(): void {
  this.activeView!.getCamera().position.set(0, 0, 100);
  this._transformation = new ViewportTransformationEventData(this);
  }

  @HostListener('wheel', ['$event'])
  mousewheel(e: WheelEvent) {
    //if tooltip is active disable zooming
    //TODO: disable zooming only when hovering over tooltip
    if (this.tooltip!.isFixed || this.activeView!.getCameraUtil() === null){
      return;
    }

    const wheelDelta = e.deltaY < 0 ? 1 : -1;

    let zoom = this._transformation.GetScale();
    const change = wheelDelta * 0.1;

    zoom *= 1 + change;

    if (zoom < 0.1) {
      zoom = 0.1;
    }

    // TODO: Coherent switch with D3 component?

    const camSizeX = this.activeView!.getCamera().right - this.activeView!.getCamera().left; //  + (this._transformation.GetZoomCursorOffsetX() - this._transformation.GetTranslateX());
    const camSizeY = this.activeView!.getCamera().bottom - this.activeView!.getCamera().top; // + (this._transformation.GetZoomCursorOffsetY() - this._transformation.GetTranslateY());

    let camUtil = this.activeView!.getCameraUtil();

    const camSizeOriginalX = (camUtil!.DataMax.x - camUtil!.DataMin.x) * camUtil!.DataScale.x;
    const camSizeOriginalY = (camUtil!.DataMax.y - camUtil!.DataMin.y) * camUtil!.DataScale.y;

    const centerVpX = this.width * 0.5;
    const centerVpY = this.height * 0.5;

    const zfX = camSizeX / camSizeOriginalX;
    const zfY = camSizeY / camSizeOriginalY;

    const normMouse = new THREE.Vector2(0, 0);

   const offsets = camUtil!.ComputeZoomOffset(zoom, normMouse);

   const data = new ViewportTransformationEventData(this,
    this._transformation.GetTranslateX(),
    this._transformation.GetTranslateY(),
    this._transformation.GetTranslateZ(), zoom,
    UpdateItemsStrategy.DefaultUpdate,
    offsets.ViewportScaleOffset.x,
    offsets.ViewportScaleOffset.y, 0,
    offsets.CursorOffset.x,
    offsets.CursorOffset.y, 0);

    this.eventAggregator.getEvent(ViewportTransformationEvent).publish(data);
  }

  @HostListener('window:resize', ['$event'])
  public onResize(event: Event) {
    this.setViewFrustum();

    if (this.renderer)
      this.renderer.onResize(this.width, this.height);
  }

  //#endregion HostListeners

  private setViewFrustum(): void {
    let camUtil = this.activeView!.getCameraUtil();
    if (camUtil === null) {
      return;
    }

    const dataMin       = camUtil!.DataMin;
    const dataMax       = camUtil!.DataMax;
    const dataScale     = camUtil!.DataScale;

    let left    = dataMin.x * dataScale.x + this._transformation.GetZoomViewportOffsetX() + this._transformation.GetZoomCursorOffsetX() + this._transformation.GetTranslateX();
    let right   = dataMax.x * dataScale.x - this._transformation.GetZoomViewportOffsetX() + this._transformation.GetZoomCursorOffsetX() + this._transformation.GetTranslateX();
    let top     = dataMin.y * dataScale.y + this._transformation.GetZoomViewportOffsetY() + this._transformation.GetZoomCursorOffsetY() + this._transformation.GetTranslateY();
    let bottom  = dataMax.y * dataScale.y - this._transformation.GetZoomViewportOffsetY() + this._transformation.GetZoomCursorOffsetY() + this._transformation.GetTranslateY();

    this.activeView!.setViewFrustum(left, top, right, bottom);
  }

  //#region SubscribedEvents
  private onRefreshPlot = (payload: boolean) => {
    if (this.data == null) {
      return;
    }

    this.activeView!.onConfiguration(this._configuration);
  }

  private onViewportTransformationUpdated = (payload: ViewportTransformationEventData) => {
    if (!(this instanceof(GlyphplotWebglComponent))) {
      return;
    }

    this._transformation = payload;

    if (!this.regionManager.IsWebGlActive()) {
      return;
   }

    this.setViewFrustum();
  }

  private fitToSelection = (payload: string) => {
    const filteredPositions: any[] = [];
    this.data.getPositions().forEach((d: any) => {
      const data = this.configuration.getFeaturesForItem(d);

        if (this.selectionService.filteredItemsIds.indexOf(d.id) > -1 || this.selectionService.featureFilters.length === 0) {
          filteredPositions.push(d.position);
        }
      });
    if (filteredPositions.length === this._data.getPositions().length || filteredPositions.length === 0) {
      return;
    }
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    minX = filteredPositions[0].x;
    maxX = filteredPositions[0].x;
    minY = filteredPositions[0].y;
    maxY = filteredPositions[0].y;
    filteredPositions.forEach( d => {
        if (d.x < minX) {
          minX = d.x;
        }
        if (d.x > maxX) {
          maxX = d.x;
        }
        if (d.y < minY) {
          minY = d.y;
        }
        if (d.y > maxY) {
          maxY = d.y;
        }
    });


    const transX = ((maxX + minX) / 2);
    const transY = ((maxY + minY) / 2);

    console.log('Fit to selection transformation: X = ' + transX + ', Y: ' + transY + ', Zoom: ');

    const args = new ViewportTransformationEventData(this, minX, minY, 0, 100, UpdateItemsStrategy.DefaultUpdate);

    this.eventAggregator.getEvent(ViewportTransformationEvent).publish(args);

  };

  private onInteractionUpdated = (payload: InteractionEventData) => {
    // TODO
    var interaction : Interaction | null = payload.GetInteractionEvent();
    switch(interaction){
      case Interaction.TouchBegin: {
        if (this.selectionEnded) {
          this.saveStartTransform = {x: payload.GetPositionX(), y: payload.GetPositionY()};
        }
    
        this.counter = 0;
    
        if (!this.configuration.useDragSelection) {
          this.configuration.currentLayout = GlyphLayout.Cluster;
          return;
        }
    
        this.selectionEnded = false;
        const startX: number = payload.GetPositionX();
        const startY: number = payload.GetPositionY();
        this._selectionRect!.start = { x: startX, y: startY };
        break;
      }
      case Interaction.TouchEnd: {
        //touchend vs dragend
        if(!this._isDraggingActive)
          return;

        if(!this.configuration.useDragSelection)
          return;
          
        this.saveEndTransform = {x: payload.GetPositionX(), y: payload.GetPositionY()};

        this._selectionRect!.clear();
        this.selectionService.data = this.data;
    
        const existingIdFilters: FeatureFilter[] = this.selectionService.featureFilters.filter((filter: FeatureFilter) => {
          if (filter instanceof IdFilter) {
            return true;
          }
          return false;
        });
    
        this.selectionService.selectByArea(this._selectionRect!.start, this._selectionRect!.end);
        const selection = this.selectionService.selectedItemsIds;
    
        this.clearIdFilters();
    
        // filter only if at least one glyph was selected
        if (selection.length > 0) {
          let idFilter: IdFilter = new IdFilter;
    
          if (this.configuration.extendSelection && existingIdFilters.length > 0) {
            const existingFilter = existingIdFilters[0];
            if (existingFilter instanceof IdFilter) {
              idFilter = existingFilter;
            }
            idFilter!.extendAccaptableIds(selection);
          } else {
            idFilter = new IdFilter('id', selection);
          }
          if (this.viewsShowTheSameDataSet()) {
            this.selectionService.featureFilters.push(idFilter);
            this.selectionService.filterRefresh();
          } else {
            this.selectionService.featureFilters.push(idFilter);
            this.selectionService.filterRefresh();
          }
        } else {
          this.selectionService.featureFilters = [];
          this.selectionService.filterRefresh();
        }
        // draws the selection rectangle if the user is currently in the specific mode
        if (this.configuration.useDragSelection) {
          this._selectionRect!.drawWebGl(payload);
        }
        this.eventAggregator.getEvent(RefreshPlotEvent).publish(true);
        this._selectionRect!.clear();
        
        this.activeView!.onSelection(this.selectionService);
        break;
      }
      case Interaction.Drag: {
        this.selectionEnded = true;
        if (this.configuration.useDragSelection){
          // draw rectangle and lock camera
          this._selectionRect!.drawWebGl(payload);
        }
        break;
      }
    }
  }

  private viewsShowTheSameDataSet(): boolean {
    return this.configurationService.configurations[0].selectedDataSetInfo.name ===
      this.configurationService.configurations[1].selectedDataSetInfo.name;
  }

  private onRefreshHover = (payload: RefreshHoverEventData) => {
    if(this.regionManager.IsD3Active())
      return;
      //show pulse effect
      if (this._configuration.useDragSelection) {
        this._selectionRect!.drawHighlightedGlyph();
      }
  }
  //#endregion SubscribedEvents

  private clearIdFilters() {
    function removeIdFilters(filter: FeatureFilter, index: number, featureFilters: FeatureFilter[]) {
      if (filter instanceof IdFilter) {
        featureFilters.splice(index, 1);
      }
    }
    // remove old idFilters
    this.selectionService.featureFilters.forEach(removeIdFilters);
  }



  //#region Tooltip
  private onHoverTooltip = () =>{
    this.isOverTooltip = true;
  }

  private onEndHoverTooltip = () =>{
    this.isOverTooltip = false;
  }
  //#endregion Tooltip

  //#region getters and setters
  get configuration() { 
    
    return this._configuration;
  }
  set configuration(value: ConfigurationData) { this._configuration = value; }
  get data(): any {
    return this._data;
  }
  set data(value: any) {
    this._data = value;
  }
  private get canvas(): HTMLCanvasElement {
    return this.canvasRef!.nativeElement;
  }
  get isOverTooltip(): boolean {
    return this._isOverTooltip;
  }
  set isOverTooltip(value: boolean) {
    this._isOverTooltip = value;
  }
  //#endregion
}