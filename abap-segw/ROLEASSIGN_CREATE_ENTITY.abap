METHOD roleassign_create_entity.
  DATA: ls_input        TYPE zcl_zuser_lock_srv_mpc=>ts_roleassign,
        lv_username     TYPE bapibname-bapibname,
        lt_agr_existing TYPE STANDARD TABLE OF bapiagr,
        lt_agr_assign   TYPE STANDARD TABLE OF bapiagr,
        ls_agr          TYPE bapiagr,
        ls_existing     TYPE bapiagr,
        lt_return       TYPE TABLE OF bapiret2,
        ls_return       TYPE bapiret2,
        ls_logondata    TYPE bapilogond,
        ls_address      TYPE bapiaddr3,
        lv_message      TYPE string.

  io_data_provider->read_entry_data(
    IMPORTING
      es_data = ls_input ).

  lv_username = ls_input-username.

  CALL FUNCTION 'BAPI_USER_GET_DETAIL'
    EXPORTING
      username       = lv_username
    IMPORTING
      logondata      = ls_logondata
      address        = ls_address
    TABLES
      activitygroups = lt_agr_existing
      return         = lt_return.

  LOOP AT lt_agr_existing INTO ls_existing.
    ls_agr-agr_name = ls_existing-agr_name.
    ls_agr-from_dat = ls_existing-from_dat.
    ls_agr-to_dat   = ls_existing-to_dat.
    APPEND ls_agr TO lt_agr_assign.
  ENDLOOP.

  CLEAR ls_agr.
  ls_agr-agr_name = ls_input-rolename.
  ls_agr-from_dat = sy-datum.
  ls_agr-to_dat   = '99991231'.
  APPEND ls_agr TO lt_agr_assign.

  CLEAR lt_return.
  CALL FUNCTION 'BAPI_USER_ACTGROUPS_ASSIGN'
    EXPORTING
      username       = lv_username
    TABLES
      activitygroups = lt_agr_assign
      return         = lt_return.

  READ TABLE lt_return INTO ls_return WITH KEY type = 'E'.
  IF sy-subrc = 0.
    CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
    lv_message = ls_return-message.
  ELSE.
    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
      EXPORTING
        wait = abap_true.
    lv_message = |Role { ls_input-rolename } assigned to { lv_username } successfully.|.
  ENDIF.

  ls_input-message = lv_message.
  er_entity = ls_input.
ENDMETHOD.
