*&---------------------------------------------------------------------*
*& Report ZKONTROL_SU53
*& IK° Kontrol — SU53 Agent capture & push
*&
*& Purpose: After a user hits an authorization error, they run this
*&          transaction. It reads the last failed authority check
*&          (SU53 data) for the current user and POSTs it as JSON to
*&          the IK° Kontrol tool, which suggests roles (SoD-checked).
*&
*& Setup required in SAP (Basis):
*&   1. SM59: create an HTTP (type G) RFC destination to the tool host,
*&      OR maintain the URL below and ensure outbound HTTP is allowed.
*&   2. STRUST: import the tool's SSL cert if using HTTPS.
*&   3. SICF: outbound HTTP must be permitted for this program's user.
*&
*& NOTE: The exact SU53 read differs across releases. This report uses
*&       the documented approach; if SUSR_SU53_GET_DATA is unavailable
*&       in your system, use the RSUSR* / authority-trace fallback noted
*&       at the bottom, or fill the fields manually for a first test.
*&---------------------------------------------------------------------*
REPORT zkontrol_su53.

*-- Change this to your IK° Kontrol ingest endpoint ---------------------
CONSTANTS: gc_url TYPE string
             VALUE 'http://YOUR-TOOL-HOST:3000/api/su53/ingest'.

*-- Structure describing one failed authorization -----------------------
TYPES: BEGIN OF ty_su53,
         sysid   TYPE string,   " system id  e.g. P10
         mandt   TYPE string,   " client     e.g. 100
         user    TYPE string,   " user id
         tcode   TYPE string,   " transaction
         object  TYPE string,   " auth object e.g. S_TCODE
         field   TYPE string,   " field       e.g. TCD
         value   TYPE string,   " value       e.g. SU01
       END OF ty_su53.

DATA: gs_su53 TYPE ty_su53,
      gv_json TYPE string,
      gv_resp TYPE string.

*======================================================================*
START-OF-SELECTION.

  PERFORM read_su53   CHANGING gs_su53.
  PERFORM build_json  USING    gs_su53
                      CHANGING gv_json.
  PERFORM http_post   USING    gv_json
                      CHANGING gv_resp.

  " Show what came back (suggested roles JSON) — later a nicer ALV/screen.
  WRITE: / 'Sent to IK Kontrol. Response:'.
  WRITE: / gv_resp.

*======================================================================*
*  Read the current user's last failed authorization (SU53 buffer)
*======================================================================*
FORM read_su53 CHANGING cs OF TYPE ty_su53.

  " Always-available context
  cs-sysid = sy-sysid.
  cs-mandt = sy-mandt.
  cs-user  = sy-uname.

  " --- Preferred: read last failed auth check for this user ----------
  " SU53 data is held per user in memory. The function below returns the
  " most recent failed authority check. (Availability is release-dependent.)
  DATA: lt_values TYPE STANDARD TABLE OF usr_authv,   " field/value list
        ls_hdr     TYPE usr_su53.

  CALL FUNCTION 'SUSR_SU53_GET_DATA'      " if not present, see fallback
    EXPORTING
      user_name        = sy-uname
    IMPORTING
      su53_header      = ls_hdr
    TABLES
      su53_values      = lt_values
    EXCEPTIONS
      no_data          = 1
      OTHERS           = 2.

  IF sy-subrc = 0.
    cs-tcode  = ls_hdr-tcode.
    cs-object = ls_hdr-object.
    " first missing field/value (agent needs one; extend to loop if needed)
    READ TABLE lt_values INTO DATA(ls_v) INDEX 1.
    IF sy-subrc = 0.
      cs-field = ls_v-field.
      cs-value = ls_v-value.
    ENDIF.
  ELSE.
    " Fallback: leave fields blank -> user can be prompted, or wire the
    " authority-trace read here (see note at bottom of report).
    MESSAGE 'No SU53 data found for user; run the failing tcode first.'
            TYPE 'I'.
  ENDIF.

ENDFORM.

*======================================================================*
*  Build the JSON payload expected by /api/su53/ingest
*======================================================================*
FORM build_json USING cs OF TYPE ty_su53
                CHANGING cv_json TYPE string.

  " Simple manual JSON (no dependency on /ui2/cl_json availability).
  " Escape is minimal; auth values are alphanumeric so this is safe.
  cv_json =
    |{ "system":"{ cs-sysid }",|  &&
    | "client":"{ cs-mandt }",|   &&
    | "user":"{ cs-user }",|      &&
    | "tcode":"{ cs-tcode }",|    &&
    | "authObject":"{ cs-object }",| &&
    | "field":"{ cs-field }",|    &&
    | "value":"{ cs-value }" }|.

ENDFORM.

*======================================================================*
*  POST the JSON to IK° Kontrol via HTTP
*======================================================================*
FORM http_post USING cv_json TYPE string
               CHANGING cv_resp TYPE string.

  DATA: lo_http TYPE REF TO if_http_client,
        lv_code TYPE i,
        lv_msg  TYPE string.

  cl_http_client=>create_by_url(
    EXPORTING
      url                = gc_url
    IMPORTING
      client             = lo_http
    EXCEPTIONS
      argument_not_found = 1
      plugin_not_active  = 2
      internal_error     = 3
      OTHERS             = 4 ).

  IF sy-subrc <> 0.
    cv_resp = 'HTTP client create failed'.
    RETURN.
  ENDIF.

  lo_http->request->set_method( if_http_request=>co_request_method_post ).
  lo_http->request->set_header_field(
      name  = 'Content-Type'
      value = 'application/json' ).
  lo_http->request->set_cdata( cv_json ).

  lo_http->send(
    EXCEPTIONS
      http_communication_failure = 1
      http_invalid_state         = 2
      OTHERS                     = 3 ).

  lo_http->receive(
    EXCEPTIONS
      http_communication_failure = 1
      http_invalid_state         = 2
      http_processing_failed     = 3
      OTHERS                     = 4 ).

  lo_http->response->get_status( IMPORTING code = lv_code ).
  cv_resp = lo_http->response->get_cdata( ).

  IF lv_code >= 400.
    cv_resp = |HTTP { lv_code }: { cv_resp }|.
  ENDIF.

  lo_http->close( EXCEPTIONS OTHERS = 0 ).

ENDFORM.

*&---------------------------------------------------------------------*
*  FALLBACK if SUSR_SU53_GET_DATA is not available in your release:
*
*  Option 1 — Authorization trace (STAUTHTRACE / STUSERTRACE):
*    Turn on trace, reproduce error, then read table by RFC or in ABAP.
*
*  Option 2 — First-test mode:
*    Comment out the CALL FUNCTION above and hardcode gs_su53 fields to
*    confirm the HTTP push + agent response work end-to-end. Then wire
*    the real SU53 read once confirmed.
*
*  Option 3 — Ask a Basis/Security colleague for the SU53 read FM used
*    on your specific S/4HANA release; the JSON build + HTTP push here
*    stay the same.
*&---------------------------------------------------------------------*
