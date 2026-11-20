package com.shifuf.prism.core

import android.os.Build
import android.webkit.WebView

object UserAgentHelper {
    private const val CHROME_VERSION = "131.0.0.0"
    private const val DESKTOP =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$CHROME_VERSION Safari/537.36"

    fun resolve(webView: WebView, profile: UaProfile, desktopMode: Boolean): String {
        return when (profile) {
            UaProfile.CHROME_DESKTOP -> DESKTOP
            UaProfile.IPHONE ->
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
            UaProfile.IPAD ->
                "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
            UaProfile.WECHAT -> mobile() + " MicroMessenger/8.0.49.2600(0x28003137) NetType/WIFI Language/zh_CN"
            UaProfile.CHROME_ANDROID -> mobile()
            UaProfile.DEFAULT -> if (desktopMode) DESKTOP else mobile()
        }
    }

    fun isDesktop(profile: UaProfile, desktopMode: Boolean): Boolean {
        return when (profile) {
            UaProfile.CHROME_DESKTOP -> true
            UaProfile.DEFAULT -> desktopMode
            else -> false
        }
    }

    /**
     * JS that overrides navigator.userAgent / platform for sites that sniff them.
     * Idempotent — never navigates or reloads.
     */
    fun spoofScript(ua: String, desktop: Boolean): String {
        val platform = if (desktop) "Win32" else "Linux armv8l"
        val uaPlatform = if (desktop) "Windows" else "Android"
        val vendor = if (ua.contains("Safari") && !ua.contains("Chrome")) "Apple Computer, Inc." else "Google Inc."
        val maxTouch = if (desktop) 0 else 5
        val mobileJs = if (desktop) "false" else "true"
        val desktopJs = if (desktop) "true" else "false"
        val safeUa = ua
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", " ")
            .replace("\r", "")
        return """
            (function(){
              try {
                if (window.__bs_ua === '$safeUa' && window.__bs_ua_desktop === $desktopJs) return;
                window.__bs_ua = '$safeUa';
                window.__bs_ua_desktop = $desktopJs;
                var ua = '$safeUa';
                var platform = '$platform';
                var vendor = '$vendor';
                var maxTouch = $maxTouch;
                function redefine(obj, prop, value) {
                  try {
                    Object.defineProperty(obj, prop, {
                      get: function(){ return value; },
                      configurable: true
                    });
                  } catch (e) {}
                }
                redefine(Navigator.prototype, 'userAgent', ua);
                redefine(Navigator.prototype, 'appVersion', ua.replace(/^Mozilla\//, ''));
                redefine(Navigator.prototype, 'platform', platform);
                redefine(Navigator.prototype, 'vendor', vendor);
                redefine(Navigator.prototype, 'maxTouchPoints', maxTouch);
                try {
                  var data = {
                    brands: [
                      {brand:'Chromium',version:'131'},
                      {brand:'Google Chrome',version:'131'},
                      {brand:'Not_A Brand',version:'24'}
                    ],
                    mobile: $mobileJs,
                    platform: '$uaPlatform',
                    getHighEntropyValues: function(){
                      return Promise.resolve({
                        platform: '$uaPlatform',
                        platformVersion: '',
                        model: '',
                        uaFullVersion: '131.0.0.0',
                        fullVersionList: this.brands
                      });
                    },
                    toJSON: function(){ return {brands:this.brands,mobile:this.mobile,platform:this.platform}; }
                  };
                  redefine(Navigator.prototype, 'userAgentData', data);
                } catch (e) {}
              } catch (e) {}
            })();
        """.trimIndent()
    }

    private fun mobile(): String {
        val release = Build.VERSION.RELEASE ?: "14"
        val model = (Build.MODEL ?: "Mobile").replace(" ", "")
        return "Mozilla/5.0 (Linux; Android $release; $model) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$CHROME_VERSION Mobile Safari/537.36"
    }
}
