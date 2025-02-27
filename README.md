<!--
Copyright 2021 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# sxg-rs

sxg-rs is a set of tools for generating [signed
exchanges](https://web.dev/signed-exchanges/) at serve time:

  * [`cloudflare_worker`](cloudflare_worker) runs on [Cloudflare Workers](https://workers.cloudflare.com/).
  * [`fastly_compute`](fastly_compute) runs on [Fastly Compute@Edge](https://www.fastly.com/products/edge-compute/serverless).
  * [`sxg_rs`](sxg_rs) is the Rust library that drives both, and could be used as a basis for other serverless platforms.

The tools here are designed to enable sites to be [prefetched from Google
Search](https://developers.google.com/search/docs/advanced/experience/signed-exchange)
in order to improve their [Largest Contentful Paint](https://web.dev/lcp/), one
of the [Core Web Vitals](https://web.dev/vitals/).

## Verify and monitor

This code was released in July 2021 and thus hasn't yet had a lot of real-world
testing. After installing, please
[verify](https://developers.google.com/search/docs/advanced/experience/signed-exchange#verify-sxg-setup)
and
[monitor](https://developers.google.com/search/docs/advanced/experience/signed-exchange#monitor-and-debug-sxg)
the results.

### Preview in Chrome

To preview the results in the browser:

 - In development, set Chrome flags to [allow the
   certificate](https://github.com/google/webpackager/tree/main/cmd/webpkgserver#testing-with-self-signed--invalid-certificates).
 - Use an extension such as
   [ModHeader](https://chrome.google.com/webstore/detail/modheader/idgpnmonknjnojddfkpgkljpfnnfcklj)
   to set the `Accept` header to
   `text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3`
   (equivalent to what Googlebot sends).
 - Explore the results [in the DevTools Network tab](https://web.dev/signed-exchanges/#debugging).

## Ensure compatibility with SXG

The Google SXG Cache may reuse an SXG for several visits to the page, or for
several users (until SXG expiration). Follow [these
instructions](https://developers.google.com/search/docs/advanced/experience/signed-exchange#additional-requirements-for-google-search)
to ensure all signed pages are compatible with such reuse. To opt some pages
out of signing, set the `Cache-Control` header to include `private` or
`no-store` in the upstream server.

The Google SXG Cache tries to [update SXGs
often](https://developers.google.com/search/docs/advanced/experience/signed-exchange#:~:text=Regardless%20of%20the,the%20SXG%20response.),
but may reuse them for up to 7 days. To ensure they expire sooner, set
`s-maxage` or `max-age` on the `Cache-Control` header on the upstream server.

## Preload subresources

LCP can be further improved by instructing Google Search to prefetch
render-critical subresources for the page. To do so, add a `Link: rel=preload`
header and a matching `Link: rel=allowed-alt-sxg` header in the upstream
server, as in [this
example](https://github.com/WICG/webpackage/blob/main/explainers/signed-exchange-subresource-substitution.md#:~:text=a%20preload%20header%20and%20an%20allowed-alt-sxg%20header).
To compute the `header-integrity` for each subresource, run:

``` bash
$ go install github.com/WICG/webpackage/go/signedexchange/cmd/dump-signedexchange@latest
$ dump-signedexchange -uri $URL -headerIntegrity
```

Ensure that the `header-integrity` remains constant over multiple fetches. If
it doesn't, try eliminating frequently changing headers from the upstream
response, by adding them to the `strip_response_headers` config param.
