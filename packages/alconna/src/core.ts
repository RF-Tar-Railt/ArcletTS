import { Constructor } from "@arcletjs/nepattern";
import { Action, Option, Subcommand, execArgs, execData } from "./base";
import { Args, Arg } from "./args";
import { Namespace, config } from "./config";
import { DataCollection, THeader } from "./typing";
import { manager } from "./manager";
import { TextFormatter } from "./formatter";
import { ParseResult, Behavior } from "./result";
import * as path from "path";

class ActionHandler extends Behavior {
  private readonly mainAction: Action | null;
  private readonly options: Map<string, Action>;

  private step(src: Subcommand, prefix: string | null = null) {
    for (let opt of src._options) {
      if (opt._action) {
        this.options.set(prefix ? `${prefix}.${opt._dest}` : opt._dest, opt._action);
      }
      if ("_options" in opt) {
        this.step(opt, prefix ? `${prefix}.${opt._dest}` : opt._dest);
      }
    }
  }

  constructor(
    source: Command
  ) {
    super();
    this.mainAction = source._action;
    this.options = new Map();
    this.step(source);
  }

  execute(result: ParseResult<any>) {
    this.beforeExecute(result);
    let source = result.source;
    if (this.mainAction) {
      this.update(result, "mainArgs", execArgs(result.mainArgs, this.mainAction, source._meta.throwError))
    }
    for (let [key, action] of this.options) {
      let d = result.query(key, undefined)
      if (d !== undefined) {
        let [end, value] = execData(d, action, source._meta.throwError);
        this.update(result, `${path}.${end}`, value);
      }
    }
  }
}



export interface TCommandMeta {
  description: string,
  usage: string | null,
  examples: string[],
  author: string | null,
  fuzzyMatch: boolean,
  throwError: boolean,
  hide: boolean,
  keepCRLF: boolean,
}

export class CommandMeta implements TCommandMeta {
  constructor(
    public description: string = "Untitled",
    public usage: string | null = null,
    public examples: string[] = [],
    public author: string | null = null,
    public fuzzyMatch: boolean = false,
    public throwError: boolean = false,
    public hide: boolean = false,
    public keepCRLF: boolean = false,
  ) {
    this.description = description;
    this.usage = usage;
    this.examples = examples;
    this.author = author;
    this.fuzzyMatch = fuzzyMatch;
    this.throwError = throwError;
    this.hide = hide;
    this.keepCRLF = keepCRLF;
  }
}

export class Command extends Subcommand {
  headers: THeader;
  command: any;
  namespace: string;
  formatter: TextFormatter;
  _meta: TCommandMeta;
  _behaviors: Behavior[];

  constructor(
    name: any | null = null,
    headers: THeader | null = null,
    args: Arg<any>[] | Args = new Args(),
    options: (Option | Subcommand)[] = [],
    action: Action | ((data: any) => any) | null = null,
    meta: TCommandMeta = new CommandMeta(),
    namespace: string | Namespace | null = null,
    separators: string[] = [" "],
    formatterType: Constructor<TextFormatter> | null = null,
    behaviors: Behavior[] | null = null,
  ) {
    if (!namespace) {
      namespace = config.default_namespace;
    } else if (namespace instanceof Namespace) {
      namespace = config.setdefault(namespace.name, namespace);
    } else {
      namespace = config.setdefault(namespace, new Namespace(namespace));
    }
    let _args = args instanceof Args ? args : new Args(...args);
    super("ALCONNA:", _args, options, null, action, separators);
    this.headers = headers || Array.from(namespace.headers);
    this.command = name || (this.headers.length > 0 ? "" : "Alconna");
    this.namespace = namespace.name;
    this._meta = meta;
    this._meta.fuzzyMatch = this._meta.fuzzyMatch || namespace.fuzzyMatch;
    this._meta.throwError = this._meta.throwError || namespace.throwError;
    this._options.push(
      new Option(
        namespace.optionName.help.join("|")
        ).help(config.lang.require("builtin.option_help")),
      new Option(
        namespace.optionName.shortcut.join("|"),
        Args.push("delete;?", "delete")
        .push("name", String)
        .push("command", String, "$")
        ).help(config.lang.require("builtin.option_shortcut")),
      new Option(
        namespace.optionName.completion.join("|")
        ).help(config.lang.require("builtin.option_completion")),
    )
    this._behaviors = behaviors || [];
    this._behaviors.splice(0, 0, new ActionHandler(this));
    this.formatter = new (formatterType || namespace.formatterType || TextFormatter)();
    this.name = `${this.command || this.headers[0]}`.replace(/ALCONNA:/g, "");
    manager.register(this);
  }

  meta(data: CommandMeta): this
  meta(data: Partial<TCommandMeta>): this
  meta(data: TCommandMeta): this {
    if (data instanceof CommandMeta) {
      this._meta = data;
    } else {
      Object.assign(this._meta, data);
    }
    return this;
  }

  get path() {
    return `${this.namespace}:${this.name}`;
  }

  get nsConfig() {
    return config.namespace[this.namespace];
  }

  resetNamespace(ns: string | Namespace, header: boolean = true): this {
    manager.delete(this);
    let namespace: Namespace
    if (typeof ns == "string") {
      namespace = config.setdefault(ns, new Namespace(ns))
    } else {
      namespace = ns
    }
    this.namespace = namespace.name
    if (header) {
      this.headers.splice(0, this.headers.length)
      //@ts-ignore
      this.headers.push(...namespace.headers)
    }
    this._options.splice(this._options.length - 3, 3)
    this._options.push(
      new Option(
        namespace.optionName.help.join("|")
        ).help(config.lang.require("builtin.option_help")),
      new Option(
        namespace.optionName.shortcut.join("|"),
        Args.push("delete;?", "delete")
        .push("name", String)
        .push("command", String, "$")
        ).help(config.lang.require("builtin.option_shortcut")),
      new Option(
        namespace.optionName.completion.join("|")
        ).help(config.lang.require("builtin.option_completion")),
    )
    this._meta.fuzzyMatch = namespace.fuzzyMatch || this._meta.fuzzyMatch
    this._meta.throwError = namespace.throwError || this._meta.throwError
    manager.register(this)
    return this
  }

  option(...args: ConstructorParameters<typeof Option>): this
  option(args: Option): this
  option(...args: any[]): this {
    manager.delete(this)
    let opt = (args[0] instanceof Option) ? args[0] : new Option(...args as ConstructorParameters<typeof Option>);
    this._options.splice(this._options.length - 3, 0, opt);
    manager.register(this)
    return this;
  }

  subcommand(...args: ConstructorParameters<typeof Subcommand>): this
  subcommand(args: Subcommand): this
  subcommand(...args: any[]): this {
    manager.delete(this)
    let sub = (args[0] instanceof Subcommand) ? args[0] : new Subcommand(...args as ConstructorParameters<typeof Subcommand>);
    this._options.splice(this._options.length - 3, 0, sub);
    manager.register(this)
    return this;
  }

  push(...args: (Option | Subcommand)[]): this {
    manager.delete(this)
    this._options.splice(this._options.length - 3, 0, ...args);
    manager.register(this)
    return this;
  }

  resetBehavior(...behaviors: Behavior[]): this {
    this._behaviors.splice(1, this._behaviors.length, ...behaviors);
    return this;
  }

  getHelp(): string {
    return this.formatter.format();
  }

  parse<T extends DataCollection<any>>(message: T): ParseResult<T> | void {
    let ana = manager.require(this)
  }
}


