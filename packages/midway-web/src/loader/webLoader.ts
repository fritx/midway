import { TagClsMetadata, TAGGED_CLS } from 'injection';
import { MidwayLoader } from 'midway-core';
import * as path from 'path';
import 'reflect-metadata';
import { WEB_ROUTER_CLS, WEB_ROUTER_PREFIX_CLS, WEB_ROUTER_PRIORITY, WEB_ROUTER_PROP } from '../decorators/metaKeys';
import { loading } from '../loading';
import { Router } from '../router';

const is = require('is-type-of');

interface MappingInfo {
  path: string;
  requestMethod: string;
  routerName: string;
  priority?: number;
}

// const debug = require('debug')('midway:web-loader');

export class MidwayWebLoader extends MidwayLoader {
  private controllerIds: string[] = [];
  private prioritySortRouters: Array<{
    priority: number,
    router: Router,
  }> = [];

  async loadController(opt: { directory? } = {}): Promise<void> {
    // load midway controller to binding router
    const appDir = path.join(this.options.baseDir, 'app/controller');
    const results = loading(this.getFileExtension('**/*'), {
      loadDirs: opt.directory || appDir,
      call: false,
    });

    for (const exports of results) {
      if (is.class(exports)) {
        await this.preInitController(exports);
      } else {
        for (const m in exports) {
          const module = exports[m];
          if (is.class(module)) {
            await this.preInitController(module);
          }
        }
      }
    }

    // must sort by priority
    if (this.prioritySortRouters.length) {
      this.prioritySortRouters = this.prioritySortRouters.sort((routerA, routerB) => {
        return routerB.priority - routerA.priority;
      });

      this.prioritySortRouters.forEach((prioritySortRouter) => {
        this.app.use(prioritySortRouter.router.middleware());
      });
    }

    // Call the parent class
    super.loadController(opt);
  }

  /**
   * 从xml加载controller
   */
  async preloadControllerFromXml(): Promise<void> {
    const ids = this.applicationContext.controllersIds;
    if (Array.isArray(ids) && ids.length > 0) {
      for (const id of ids) {
        const controllers = await this.applicationContext.getAsync(id);
        const app = this.app;
        if (Array.isArray(controllers.list)) {
          controllers.list.forEach(c => {
            const newRouter = new Router({
              sensitive: true,
            }, app);
            c.expose(newRouter);

            app.use(newRouter.middleware());
          });
        }
      }
    }
  }

  /**
   * register controller when it has @controller decorator
   * @param module
   */
  private async preInitController(module): Promise<void> {
    const metaData = Reflect.getMetadata(TAGGED_CLS, module) as TagClsMetadata;
    if (metaData && metaData.id) {
      if (this.controllerIds.indexOf(metaData.id) > -1) {
        throw new Error(`controller identifier [${metaData.id}] is exists!`);
      }
      this.controllerIds.push(metaData.id);

      this.preRegisterRouter(module, metaData.id);
    }
  }

  private preRegisterRouter(target, controllerId) {
    const app = this.app;
    const controllerPrefix = Reflect.getMetadata(WEB_ROUTER_PREFIX_CLS, target);
    let newRouter;
    if (controllerPrefix) {
      newRouter = new Router({
        sensitive: true,
      }, app);
      newRouter.prefix(controllerPrefix);
      const methodNames = Reflect.getMetadata(WEB_ROUTER_CLS, target);

      if (methodNames && typeof methodNames[Symbol.iterator] === 'function') {
        for (const methodName of methodNames) {
          const mappingInfos: MappingInfo[] = Reflect.getMetadata(WEB_ROUTER_PROP, target, methodName);
          if (mappingInfos && mappingInfos.length) {
            for (const mappingInfo of mappingInfos) {
              const routerArgs = [
                mappingInfo.routerName,
                mappingInfo.path,
                this.generateController(`${controllerId}.${methodName}`),
              ];
              // apply controller from request context
              newRouter[mappingInfo.requestMethod].apply(newRouter, routerArgs);
            }
          }
        }
      }
    }

    // sort for priority
    if (newRouter) {
      const priority = Reflect.getMetadata(WEB_ROUTER_PRIORITY, target);
      this.prioritySortRouters.push({
        priority: priority || 0,
        router: newRouter,
      });
    }
  }

  /**
   * wrap controller string to middleware function
   * @param controllerMapping like xxxController.index
   */
  generateController(controllerMapping: string) {
    const mappingSplit = controllerMapping.split('.');
    const controllerId = mappingSplit[0];
    const methodName = mappingSplit[1];
    return async (ctx, next) => {
      const controller = await ctx.requestContext.getAsync(controllerId);
      return controller[methodName].call(controller, ctx, next);
    };
  }

  protected getFileExtension(names: string | string[]): string[] {
    if (typeof names === 'string') {
      names = [names];
    }

    let arr = [];
    names.forEach((name) => {
      arr = arr.concat([name + '.ts', name + '.js']);
    });
    return arr.concat(['!**/**.d.ts']);
  }

  async refreshContext(): Promise<void> {
    await super.refreshContext();
    await this.preloadControllerFromXml();
  }
}
