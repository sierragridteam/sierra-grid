import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/live',timeout:90000,workers:1,use:{baseURL:'http://127.0.0.1:8185',headless:true,viewport:{width:1440,height:1050}},reporter:'list'});
