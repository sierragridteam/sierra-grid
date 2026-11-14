import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser', fullyParallel:false, workers:1, timeout:60000,
  use:{baseURL:'http://127.0.0.1:8190', viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  webServer:{command:'python3 -m http.server 8190 --bind 127.0.0.1 --directory dist',url:'http://127.0.0.1:8190',reuseExistingServer:false,timeout:15000},
});
