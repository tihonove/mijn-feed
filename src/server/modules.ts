// DI wiring shared by main.ts and integration tests.
import {
    type AuthConfig,
    AuthConfigDIToken,
    AuthService,
    AuthServiceDIToken,
    FetchDIToken,
    type FetchLike,
} from "./auth/authService.ts";
import { ClockDIToken, type IClock, SystemClock } from "./clock.ts";
import { DatabaseDIToken, type IDatabase, SqliteDatabase } from "./db/database.ts";
import { DeckService, DeckServiceDIToken } from "./deck/deckService.ts";
import { FsrsScheduler, SchedulerDIToken } from "./deck/scheduler.ts";
import type { ContainerModule } from "./di/container.ts";
import { FeedService, FeedServiceDIToken } from "./feed/feedService.ts";
import { Api, ApiDIToken } from "./http/api.ts";
import { HttpServer, HttpServerDIToken, StaticFilesDIToken } from "./http/server.ts";
import { StaticFiles } from "./http/staticFiles.ts";
import { ItemService, ItemServiceDIToken } from "./items/itemService.ts";
import { MediaDirDIToken, MediaService, MediaServiceDIToken } from "./media/mediaService.ts";
import { SettingsService, SettingsServiceDIToken } from "./settings/settingsService.ts";

export interface AppModuleContext {
    dbPath: string;
    mediaDir: string;
    appDir: string | null;
    auth: AuthConfig;
    clock?: IClock;
    fetch?: FetchLike;
    db?: IDatabase;
}

export const appModule: ContainerModule<AppModuleContext> = (c, ctx) => {
    c.bind(ClockDIToken, () => ctx.clock ?? new SystemClock());
    c.bind(DatabaseDIToken, () => ctx.db ?? new SqliteDatabase(ctx.dbPath));
    c.bind(SchedulerDIToken, () => new FsrsScheduler());
    c.bind(SettingsServiceDIToken, SettingsService);
    c.bind(DeckServiceDIToken, DeckService);
    c.bind(ItemServiceDIToken, ItemService);
    c.bind(FeedServiceDIToken, FeedService);
    c.bind(MediaDirDIToken, () => ctx.mediaDir);
    c.bind(MediaServiceDIToken, MediaService);
    c.bind(AuthConfigDIToken, () => ctx.auth);
    c.bind(FetchDIToken, () => ctx.fetch ?? ((url, init) => fetch(url, init)));
    c.bind(AuthServiceDIToken, AuthService);
    c.bind(ApiDIToken, Api);
    c.bind(StaticFilesDIToken, () => new StaticFiles(ctx.appDir));
    c.bind(HttpServerDIToken, HttpServer);
};
