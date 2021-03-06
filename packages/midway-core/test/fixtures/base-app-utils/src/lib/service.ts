import {config, plugin, logger} from '../../../../../src/decorators';
import {provide, inject} from 'injection';

@provide()
export class BaseService {
  @inject()
  ctx;

  @config('hello')
  config;

  @plugin('plugin2')
  plugin2;

  @inject('is')
  isModule;

  @logger()
  logger;

  async getData() {
    return this.isModule.function('hello').toString() + this.config.c;
  }
}
